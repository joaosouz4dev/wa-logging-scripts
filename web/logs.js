if (!window.logBack) {
    window.logBack = {}
    for (const level of ['LOG', 'INFO', 'WARN', 'ERROR', 'DEBUG', 'TRACE']) {
        const fn = require('WALogger')[level]
        if (typeof fn === 'function') {
            window.logBack[level] = fn
        }
    }
}

const COLORS = {
    LOG: '\u001B[36m', // cyan
    INFO: '\u001B[34m', // blue
    WARN: '\u001B[33m', // yellow
    ERROR: '\u001B[31m', // red
    DEBUG: '\u001B[90m', // grey
    TRACE: '\u001B[90m' // grey
}
const RESET = '\u001B[0m'

for (const level of Object.keys(window.logBack)) {
    require('WALogger')[level] = (...args) => {
        const result = window.logBack[level](...args)
        console.log(`${COLORS[level] || ''}[${level}]${RESET}`, ...args)
        return result
    }
}
