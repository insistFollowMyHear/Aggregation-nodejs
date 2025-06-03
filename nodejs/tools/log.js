function logInfoWithTimestamp(...args) {
    const now = new Date();
    const timeStr = now.toISOString().replace('T', ' ').replace('Z', ''); // 格式：YYYY-MM-DD HH:MM:SS.sss
    console.log(`[${timeStr}]`, ...args);
}

function logErrWithTimestamp(...args) {
    const now = new Date();
    const timeStr = now.toISOString().replace('T', ' ').replace('Z', ''); // 格式：YYYY-MM-DD HH:MM:SS.sss
    console.error(`[${timeStr}]`, ...args);
}

function logWarnWithTimestamp(...args) {
    const now = new Date();
    const timeStr = now.toISOString().replace('T', ' ').replace('Z', ''); // 格式：YYYY-MM-DD HH:MM:SS.sss
    console.warn(`[${timeStr}]`, ...args);
}

module.exports = {
    logInfoWithTimestamp,
    logWarnWithTimestamp,
    logErrWithTimestamp
};