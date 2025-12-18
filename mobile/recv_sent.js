Java.perform(function () {
    var Log = Java.use('android.util.Log')
    var Exception = Java.use('java.lang.Exception')
    var SocketOutputStream = Java.use('java.net.SocketOutputStream')
    var MessageCls = null
    try {
        MessageCls = Java.use('android.os.Message')
    } catch (e) {}

    function safeToString(obj) {
        try {
            return obj === null ? '<null>' : obj.toString()
        } catch (e) {
            try {
                return '' + obj
            } catch (e2) {
                return '<unprintable>'
            }
        }
    }

    function formatValue(v) {
        try {
            if (v === null || v === undefined) return '<null>'
            // byte[]
            if (v.$className === '[B') {
                return '<byte[' + v.length + '] ' + bytesToHex(v, 0, v.length) + '>'
            }
            // android.os.Message
            if (MessageCls && MessageCls.class.isInstance(v)) {
                var what = -1
                var arg1 = 0
                var arg2 = 0
                var objStr = '<null>'
                try {
                    what = v.what.value
                } catch (e) {}
                try {
                    arg1 = v.arg1.value
                } catch (e) {}
                try {
                    arg2 = v.arg2.value
                } catch (e) {}
                try {
                    var o = v.obj.value
                    objStr = formatValue(o)
                } catch (e) {}
                return (
                    '<Message what=' +
                    what +
                    ' arg1=' +
                    arg1 +
                    ' arg2=' +
                    arg2 +
                    ' obj=' +
                    objStr +
                    '>'
                )
            }
            return safeToString(v)
        } catch (e) {
            return safeToString(v)
        }
    }

    function bytesToHex(b, off, len) {
        var out = []
        var end = off + len
        if (off < 0) off = 0
        if (end > b.length) end = b.length
        // Cap output to avoid blowing up console
        var max = 512
        if (end - off > max) end = off + max
        for (var i = off; i < end; i++) {
            var v = b[i] & 0xff
            out.push((v < 16 ? '0' : '') + v.toString(16))
        }
        return out.join('') + (len > max ? '...' : '')
    }

    var hooked = {
        send: new Set(),
        recv: new Set()
    }

    var lock = {
        send: false,
        recv: false
    }

    var seenNode = {
        send: false,
        recv: false
    }

    // Wire-like selection: once we find the closest-to-wire writer/parser, log only from it.
    var wireSelected = {
        send: null,
        recv: null
    }

    function looksLikeNodeString(s) {
        if (!s || typeof s !== 'string') return false
        return (
            s.indexOf('<iq') !== -1 ||
            s.indexOf('<message') !== -1 ||
            s.indexOf('<notification') !== -1 ||
            s.indexOf('<receipt') !== -1 ||
            s.indexOf('<presence') !== -1 ||
            s.indexOf('<ib') !== -1 ||
            s.indexOf('<ack') !== -1 ||
            s.indexOf('<success') !== -1 ||
            s.indexOf('<failure') !== -1
        )
    }

    var lastEmitted = new Map()
    function emitNode(label, nodeStr) {
        // Normalize whitespace a bit
        var s = (nodeStr || '').trim()
        if (!s) return

        var id = ''
        var m1 = s.match(/\bid='([^']+)'/)
        if (m1) {
            id = m1[1]
        } else {
            var m2 = s.match(/\bid=\"([^\"]+)\"/)
            if (m2) id = m2[1]
        }

        var type = ''
        var t1 = s.match(/\btype='([^']+)'/)
        if (t1) {
            type = t1[1]
        } else {
            var t2 = s.match(/\btype=\"([^\"]+)\"/)
            if (t2) type = t2[1]
        }

        // De-duplicate per direction: we still want to see SEND and RECV for the same id.
        var key = label + '|' + id + '|' + type + '|' + s
        var now = Date.now()
        var prev = lastEmitted.get(key)
        if (prev && now - prev < 1500) {
            return
        }
        lastEmitted.set(key, now)

        var prefix =
            '\u001B[' + (label === 'send' ? '32' : '31') + 'm[' + label.toUpperCase() + ']\u001B[0m'
        if (id) {
            console.log(prefix, 'id=' + id + (type ? ' type=' + type : ''))
        } else {
            console.log(prefix)
        }
        console.log(s)
    }

    function extractNodeStrings(formattedArgs, formattedRet) {
        var nodes = []

        function maybePushNode(s) {
            if (!s || typeof s !== 'string') return

            // If it's a Message wrapper, prefer extracting obj=<...> instead of treating the whole Message as the node.
            if (s.startsWith('<Message') && s.indexOf(' obj=<') !== -1) {
                var idx0 = s.indexOf(' obj=<')
                var candidate0 = s.substring(idx0 + 6) // after " obj=<"
                if (candidate0.endsWith('>')) {
                    candidate0 = candidate0.substring(0, candidate0.length - 1)
                }
                if (looksLikeNodeString(candidate0)) {
                    nodes.push(candidate0)
                }
                return
            }

            if (looksLikeNodeString(s)) {
                nodes.push(s)
                return
            }
            // Format from formatValue(Message): <Message ... obj=<iq ...>>
            if (s.indexOf(' obj=<') !== -1) {
                var idx = s.indexOf(' obj=<')
                var candidate = s.substring(idx + 6)
                if (candidate.endsWith('>')) {
                    candidate = candidate.substring(0, candidate.length - 1)
                }
                if (looksLikeNodeString(candidate)) {
                    nodes.push(candidate)
                }
            }
        }

        for (var i = 0; i < formattedArgs.length; i++) {
            maybePushNode(formattedArgs[i])
        }
        maybePushNode(formattedRet)
        return nodes
    }

    function parseHookTargetsFromStack(stack) {
        // Wire-like goal: pick code closest to the socket boundary (writer/parser), not app-level handlers.
        // We first try to locate the socket frame (Socket*Stream.{read,write}) and take a few X.* frames ABOVE it.
        // If we can't find it (some stacks), fall back to the older boundary-based heuristic.
        var lines = (stack || '').split('\n')
        var frames = []

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim()
            var m = line.match(/at\s+([\w.$]+)\.([\w$<>]+)\(/)
            if (!m) continue
            frames.push({ idx: i, className: m[1], methodName: m[2], rawLine: line })
        }

        function isCandidate(f) {
            if (!f.className.startsWith('X.')) return false
            if (f.methodName === 'read' || f.methodName === 'write' || f.methodName === 'flush')
                return false
            // Avoid very high-level Android entrypoints
            if (f.methodName === 'handleMessage' || f.methodName === 'onReceive') return false
            return true
        }

        // 1) Prefer frames closest to socket boundary
        var socketIdx = -1
        for (var si = 0; si < lines.length; si++) {
            var sl = lines[si]
            if (
                sl.indexOf('java.net.SocketOutputStream.write') !== -1 ||
                sl.indexOf('java.net.SocketInputStream.read') !== -1
            ) {
                socketIdx = si
                break
            }
        }

        if (socketIdx !== -1) {
            var near = []
            // Walk downwards (away from socket) to pick the first few X.* frames
            for (var di = socketIdx + 1; di < lines.length; di++) {
                var dl = lines[di].trim()
                var md = dl.match(/at\s+([\w.$]+)\.([\w$<>]+)\(/)
                if (!md) continue
                var cand = { className: md[1], methodName: md[2], rawLine: dl }
                if (!isCandidate(cand)) continue
                near.push(cand)
                if (near.length >= 6) break
            }
            if (near.length) {
                return near
            }
        }

        // 2) Fallback: Find boundary index in original stack lines (not in frames list)
        var boundaryIdx = -1
        for (var j = 0; j < lines.length; j++) {
            var s = lines[j]
            if (
                s.indexOf('android.os.Handler.dispatchMessage') !== -1 ||
                s.indexOf('android.os.Looper.loop') !== -1 ||
                s.indexOf('android.os.HandlerThread.run') !== -1 ||
                s.indexOf('java.lang.Thread.run') !== -1
            ) {
                boundaryIdx = j
                break
            }
        }

        // If boundary found, scan upwards for X.* candidate.
        var out = []
        if (boundaryIdx !== -1) {
            for (var k = boundaryIdx - 1; k >= 0; k--) {
                var lineK = lines[k].trim()
                var mk = lineK.match(/at\s+([\w.$]+)\.([\w$<>]+)\(/)
                if (!mk) continue
                var f = { className: mk[1], methodName: mk[2], rawLine: lineK }
                if (!isCandidate(f)) continue
                out.push(f)
                if (out.length >= 6) break
            }
            if (out.length) {
                return out
            }
        }

        // Fallback: scan around any .run() and take frames ABOVE it (not after).
        for (var r = 0; r < lines.length; r++) {
            if (lines[r].indexOf('.run(') !== -1) {
                for (var u = r - 1; u >= 0 && r - u <= 10; u--) {
                    var lu = lines[u].trim()
                    var mu = lu.match(/at\s+([\w.$]+)\.([\w$<>]+)\(/)
                    if (!mu) continue
                    var fu = { className: mu[1], methodName: mu[2], rawLine: lu }
                    if (!isCandidate(fu)) continue
                    out.push(fu)
                }
                if (out.length) {
                    return out
                }
            }
        }

        // Final fallback: any X.* frame not read/write
        for (var z = frames.length - 1; z >= 0; z--) {
            var fz = frames[z]
            if (!isCandidate(fz)) continue
            out.push({
                className: fz.className,
                methodName: fz.methodName,
                rawLine: fz.rawLine
            })
            if (out.length >= 6) break
        }
        if (!out.length) return null
        return out
    }

    function hookAllOverloads(className, methodName, label) {
        var key = className + '.' + methodName
        if (hooked[label].has(key)) return
        hooked[label].add(key)

        var Cls
        try {
            Cls = Java.use(className)
        } catch (e) {
            console.log('[AUTO] Failed to Java.use(' + className + '):', e)
            return
        }

        if (!Cls[methodName] || !Cls[methodName].overloads) {
            console.log('[AUTO] Method not found:', className + '.' + methodName)
            return
        }

        console.log(
            '[AUTO] Hooking ' + label.toUpperCase() + ' target:',
            className + '.' + methodName
        )

        // Don't lock just because we hit handleMessage.
        // Some send paths have obj=<null> at handleMessage, while the node appears in a nearby helper.

        Cls[methodName].overloads.forEach(function (ov) {
            ov.implementation = function () {
                // If a wire method was already selected, ignore other hooks.
                if (wireSelected[label] && wireSelected[label] !== key) {
                    return ov.call(this, ...arguments)
                }

                var args = []
                for (var i = 0; i < arguments.length; i++) {
                    args.push(formatValue(arguments[i]))
                }

                var ret
                try {
                    ret = ov.call(this, ...arguments)
                } catch (e) {
                    // Don't kill the script on transient IO exceptions (common during reconnects)
                    console.log(
                        '\u001B[33m[' + label.toUpperCase() + '][EXCEPTION]\u001B[0m',
                        className + '.' + methodName,
                        String(e)
                    )
                    return ret
                }

                var retStr = ret !== undefined ? formatValue(ret) : ''
                var nodes = extractNodeStrings(args, retStr)
                var nodeLike = nodes.length > 0

                // If this hook isn't producing nodes, don't spam the console.
                if (!nodeLike) {
                    return ret
                }

                // Pick first method that produces a node as our wire-like target.
                if (!wireSelected[label]) {
                    wireSelected[label] = key
                    lock[label] = true
                }

                // Track success.
                seenNode[label] = true

                // Emit de-duplicated nodes only (no method noise)
                for (var n = 0; n < nodes.length; n++) {
                    emitNode(label, nodes[n])
                }
                return ret
            }
        })
    }

    function ensureAutoHook(stackTrace, label) {
        try {
            if (lock[label] || wireSelected[label]) return
            var targets = parseHookTargetsFromStack(stackTrace)
            if (!targets || !targets.length) return
            // For SEND we hook a couple of top candidates because the first one is often handleMessage
            // with obj=<null>. The node frequently appears in the next helper call.
            var limit = 3
            for (var i = 0; i < targets.length && i < limit; i++) {
                var t = targets[i]
                var key = t.className + '.' + t.methodName
                if (hooked[label].has(key)) continue
                console.log('[AUTO] Candidate (' + label + '):', t.rawLine)
                hookAllOverloads(t.className, t.methodName, label)
                if (seenNode[label]) break
            }
        } catch (e) {
            console.log('[AUTO] ensureAutoHook failed:', e)
        }
    }

    var write3 = SocketOutputStream.write.overload('[B', 'int', 'int')
    write3.implementation = function (b, off, len) {
        if (!wireSelected.send) {
            var stackTrace = Log.getStackTraceString(Exception.$new())
            ensureAutoHook(stackTrace, 'send')
        }

        return write3.call(this, b, off, len)
    }

    var write1 = SocketOutputStream.write.overload('[B')
    write1.implementation = function (b) {
        if (!wireSelected.send) {
            var stackTrace = Log.getStackTraceString(Exception.$new())
            ensureAutoHook(stackTrace, 'send')
        }

        return write1.call(this, b)
    }

    var SocketInputStream = Java.use('java.net.SocketInputStream')

    var read3 = SocketInputStream.read.overload('[B', 'int', 'int')
    read3.implementation = function (b, off, len) {
        var bytesRead = read3.call(this, b, off, len)
        if (!wireSelected.recv && bytesRead > 0) {
            var stackTrace = Log.getStackTraceString(Exception.$new())
            ensureAutoHook(stackTrace, 'recv')
        }

        return bytesRead
    }

    var read1 = SocketInputStream.read.overload('[B')
    read1.implementation = function (b) {
        var bytesRead = read1.call(this, b)
        if (!wireSelected.recv && bytesRead > 0) {
            var stackTrace = Log.getStackTraceString(Exception.$new())
            ensureAutoHook(stackTrace, 'recv')
        }

        return bytesRead
    }
})
