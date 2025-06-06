const userService = require('../services/userService');

exports.Buy = async (req, res, next) => {
    try {
        await userService.buy(req.body);
        res.send({
            code: 200,
            msg: 'success',
            data: null
        })
    } catch (err) {
        next(err); // 将错误传递给全局错误处理器
    }
};

exports.Sell = async (req, res, next) => {
    try {
        await userService.sell(req.body);
        res.send({
            code: 200,
            msg: 'success',
            data: null
        })
    } catch (err) {
        next(err); // 将错误传递给全局错误处理器
    }
};

exports.SetPair = async (req, res, next) => {
    try {
        await userService.SetPair(req.body);
        res.send({
            code: 200,
            msg: 'success',
            data: null
        })
    } catch (err) {
        next(err); // 将错误传递给全局错误处理器
    }
};

exports.GetTokens = async (req, res, next) => {
    try {
        const tokens = await userService.GetTokens();
        res.send({
            code: 200,
            msg: 'success',
            data: tokens
        })
    } catch (err) {
        next(err); // 将错误传递给全局错误处理器
    }
};

exports.GetPools = async (req, res, next) => {
    try {
        const pools = await userService.GetPools();
        res.send({
            code: 200,
            msg: 'success',
            data: pools
        })
    } catch (err) {
        next(err); // 将错误传递给全局错误处理器
    }
};

exports.GetPair = async (req, res, next) => {
    try {
        const pair = await userService.GetPair(req.query);
        res.send({
            code: 200,
            msg: 'success',
            data: pair
        })
    } catch (err) {
        next(err); // 将错误传递给全局错误处理器
    }
};

exports.GetLog = async (req, res, next) => {
    try {
        const log = await userService.GetLog(req.query);
        res.send({
            code: 200,
            msg: 'success',
            data: log
        })
    } catch (err) {
        next(err); // 将错误传递给全局错误处理器
    }
};

exports.GetPrice = async (req, res, next) => {
    try {
        // const prices = await userService.GetPrice(req.query);
        const para = await userService.getPricePara(req.query);
        res.send({
            code: 200,
            msg: 'success',
            data: para
        })
    } catch (err) {
        next(err); // 将错误传递给全局错误处理器
    }
};

/**
 * 获取指定哈希的 UTXO
 */
exports.GetUTXOsByHashes = async (req, res, next) => {
    try {
        const { address, hashes } = req.body;
        if (!address || !hashes || !Array.isArray(hashes)) {
            return res.status(400).send({
                code: 400,
                msg: '参数错误：address 和 hashes 数组是必需的',
                data: null
            });
        }

        const utxos = await userService.getUTXOsByHashes(address, hashes);
        res.send({
            code: 200,
            msg: 'success',
            data: utxos
        });
    } catch (err) {
        next(err);
    }
};

/**
 * 获取指定哈希的 FT UTXO
 */
exports.GetFTUTXOsByHashes = async (req, res, next) => {
    try {
        const { address, ftContractTxid, hashes } = req.body;
        if (!address || !ftContractTxid || !hashes || !Array.isArray(hashes)) {
            return res.status(400).send({
                code: 400,
                msg: '参数错误：address、ftContractTxid 和 hashes 数组是必需的',
                data: null
            });
        }

        const ftUtxos = await userService.getFTUTXOsByHashes(address, ftContractTxid, hashes);
        res.send({
            code: 200,
            msg: 'success',
            data: ftUtxos
        });
    } catch (err) {
        next(err);
    }
};

/**
 * 获取转账 FT 手续费的 UTXO
 */
exports.GetTransferFTFeeUTXOs = async (req, res, next) => {
    try {
        const { address, count = 1 } = req.body;
        if (!address) {
            return res.status(400).send({
                code: 400,
                msg: '参数错误：address 是必需的',
                data: null
            });
        }

        const utxos = await userService.getTransferFTFeeUTXOs(address, count);
        res.send({
            code: 200,
            msg: 'success',
            data: utxos
        });
    } catch (err) {
        next(err);
    }
};