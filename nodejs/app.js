require('dotenv').config();

var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var cors = require('cors');
const UTXOManager = require('./services/utxoManager');
const utxoConfig = require('./config/utxo');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');

var app = express();

// 初始化 UTXOManager
let utxoManager;
async function initUTXOManager() {
    try {
        utxoManager = new UTXOManager(utxoConfig);
        await utxoManager.init();
        console.log('UTXOManager initialized successfully');
        
        // 将 utxoManager 实例添加到全局变量中
        global.utxoManager = utxoManager;
    } catch (error) {
        console.error('Failed to initialize UTXOManager:', error);
        process.exit(1); // 如果 UTXOManager 初始化失败，终止应用
    }
}

// 启动 UTXOManager
initUTXOManager();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

// CORS 配置
const corsOptions = {
    origin: '*',  // 允许所有来源访问
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',  // 允许的 HTTP 方法
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Accept',
        'Origin'
    ],
    exposedHeaders: ['Content-Range', 'X-Content-Range'],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204,
    maxAge: 86400  // 预检请求结果缓存 24 小时
};

// 启用 CORS 和 JSON 解析
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// 添加中间件来确保 UTXOManager 已初始化
app.use((req, res, next) => {
    if (!utxoManager) {
        return res.status(503).json({
            code: 503,
            msg: 'Service temporarily unavailable: UTXOManager not initialized',
            data: {}
        });
    }
    next();
});

app.use('/', indexRouter);
app.use('/pool', usersRouter);

// require('./jobs/aggregation');

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  console.error(err.stack);
  const statusCode = err.status || 500;
  const response = {
    code: statusCode,
    msg: err.message || http.STATUS_CODES[statusCode] || 'Internal Server Error',
    data: {}
  };

  // render the error page
  res.status(err.status || 500).json(response);
});

module.exports = app;
