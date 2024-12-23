if(!window.syncIqBack){
    window.syncIqBack = require("WAWebSyncdRequestBuilderBuild").buildSyncIqNode
}
  
require("WAWebSyncdRequestBuilderBuild").buildSyncIqNode = (a) => {
    const result = window.syncIqBack(a)
    const values = Array.from(a.values()).flat()
    
    console.log(
        '\u001B[35m[APP STATE MUTATION]\u001B[0m',
        values.map(v => (
                {
                    ...v,
                    binarySyncAction: require("decodeProtobuf").decodeProtobuf(require("WASyncAction.pb").SyncActionValueSpec, v.binarySyncAction)
                }
            )
        )
    )
    return result
}
  