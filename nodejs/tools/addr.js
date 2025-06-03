const tbc = require("tbc-lib-js");

function generate(num = 10) {
    const results = [];
    for (let i = 1; i <= num; i++) {
        var mnemonic = tbc.Mnemonic.fromRandom();
        // get HDPrivateKey from mnemonic
        var HDPrivateKey = mnemonic.toHDPrivateKey('', 'livenet');
        // create private key from seed with compressed format
        // will sign the transaction with this private key
        var DerivationPath = "m/44'/236'/0'/1/0";
        var derivedHDPrivateKey = HDPrivateKey.deriveChild(DerivationPath);
        var privateKey = derivedHDPrivateKey.privateKey;
        // get address from private key
        var address = privateKey.toAddress();
        // print results
        // console.log('private key:', privateKey.toString());
        // console.log('mnemonic:', mnemonic.phrase);
        // console.log('address:', address.toString());
        results.push({
            private: privateKey.toString(),
            mnemonic: mnemonic.phrase,
            address: address.toString()
        });
    }
    return results;
}

module.exports = {
    generate
};