if (!window.pB) {
    window.pb = require("WAWebClientPayload").getClientPayloadForRegistration
}

require("WAWebClientPayload").getClientPayloadForRegistration = async (...args) => {
    const result = await window.pb(...args)
    const decoded = require("decodeProtobuf").decodeProtobuf(require("WAWebProtobufsWa6.pb").ClientPayloadSpec, result)
    console.log('\u001B[32m[REGISTRATION]\u001B[0m', decoded, require("decodeProtobuf").decodeProtobuf(require("WAWebProtobufsCompanionReg.pb").DevicePropsSpec, decoded.devicePairingData.deviceProps))
    return result
}