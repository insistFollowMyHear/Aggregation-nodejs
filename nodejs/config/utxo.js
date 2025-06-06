module.exports = {
    network: process.env.NETWORK || 'mainnet',
    addresses: process.env.ADDRESSES ? process.env.ADDRESSES.split(',') : [],
    privateKeys: process.env.PRIVATE_KEYS ? process.env.PRIVATE_KEYS.split(',') : []
}; 