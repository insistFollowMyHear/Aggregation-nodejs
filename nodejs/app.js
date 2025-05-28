require('dotenv').config();

var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var cors = require('cors');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');

var app = express();

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
