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