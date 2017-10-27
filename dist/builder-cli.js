#!/usr/bin/env node
"use strict";
var __assign = (this && this.__assign) || Object.assign || function(t) {
    for (var s, i = 1, n = arguments.length; i < n; i++) {
        s = arguments[i];
        for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
            t[p] = s[p];
    }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
var child_process_1 = require("child_process");
var treeKill = require("tree-kill");
var path_1 = require("path");
var logger_1 = require("./logger");
var packageJson = require('../package.json');
var Liftoff = require('liftoff');
var argv = require('minimist')(process.argv.slice(2));
var PATH = 'PATH';
var sh = 'sh';
var shFlag = '-c';
if (process.platform === 'win32') {
    sh = process.env.comspec || 'cmd';
    shFlag = '/d /s /c';
}
// windows calls it's path 'Path' usually, but this is not guaranteed.
if (process.platform === 'win32') {
    PATH = 'Path';
    Object.keys(process.env).forEach(function (e) {
        if (e.match(/^PATH$/i)) {
            PATH = e;
        }
    });
}
var runningTasks = new Map();
var promiseSeries = function (promises) { return promises.reduce(function (current, next) { return current.then(next); }, Promise.resolve(undefined)); };
var listTasks = function (registeredTasks) {
    logger_1.logger.log('Tasks');
    registeredTasks.forEach(function (v, k) {
        logger_1.logger.log(k + ": " + v.description);
    });
    logger_1.logger.log('');
};
var Builder = new Liftoff({
    name: 'builder',
    extensions: require('interpret').jsVariants
});
var logFailureAndExit = function (e) {
    logger_1.logger.error("Task " + e.name + " failed");
    process.exit(1);
};
Builder.launch({
    cwd: argv.cwd
}, function (env) {
    var taskName = argv._[0];
    if (!env.configPath) {
        return logger_1.logger.error('No builderfile found.');
    }
    if (!env.modulePath) {
        return logger_1.logger.error('Builder is not installed locally.');
    }
    if (packageJson.version !== env.modulePackage.version) {
        logger_1.logger.warn("Global version " + packageJson.version + " is different from local version " + env.modulePackage.version + ".");
    }
    require(env.configPath);
    var _a = require(env.modulePath), registeredTasks = _a.registeredTasks, ModuleTask = _a.Task;
    if (!taskName) {
        return listTasks(registeredTasks);
    }
    var task = registeredTasks.get(taskName);
    if (task === undefined) {
        logger_1.logger.error("Could not find task '" + taskName + "'.");
        process.exit(1);
        return;
    }
    var runTask = function (task) {
        var taskLogger = logger_1.createTaskLogger(task.name);
        taskLogger('started');
        return new Promise(function (resolve, reject) {
            var start = Date.now();
            var nodeModulesBinPath = path_1.join(task.cwd, 'node_modules/.bin');
            var envPath = [task.env[PATH], process.env[PATH], nodeModulesBinPath]
                .filter(function (p) { return !!p; })
                .join(path_1.delimiter);
            var childProcess = child_process_1.execFile(sh, [shFlag, task.cmd], {
                cwd: task.cwd,
                env: __assign({}, task.env, process.env, (_a = {}, _a[PATH] = envPath, _a))
            }, function (error, stdout, stderr) {
                var didFail = !!error;
                taskLogger('output');
                logger_1.logger.info((stderr.length ? stderr : stdout).trim());
                taskLogger("finished (" + (Date.now() - start) / 1000 + "s)");
                if (!task.isLongRunning) {
                    didFail ? reject({ name: task.name }) : resolve();
                }
                runningTasks.delete(childProcess);
            });
            runningTasks.set(childProcess, task);
            if (task.isLongRunning) {
                setImmediate(function () { return resolve(); });
            }
            var _a;
        })
            .then(function () { return (task.onExit && !task.isLongRunning) ? runTaskOrTasks(task.onExit) : undefined; });
    };
    var runTasks = function (tasks) {
        return tasks.isParallel
            ? Promise.all(tasks.tasks.map(runTask)).then(function () { return undefined; })
            : promiseSeries(tasks.tasks.map(function (task) { return function () { return runTask(task); }; }));
    };
    var runTaskOrTasks = function (t) { return t instanceof ModuleTask ? runTask(t) : runTasks(t); };
    var killAllTasks = function () {
        runningTasks.forEach(function (task, cp) {
            treeKill(cp.pid, undefined, function () {
                if (task.onExit !== undefined) {
                    runTaskOrTasks(task.onExit)
                        .then(killAllTasks, logFailureAndExit);
                }
            });
        });
    };
    var createTaskExecutionStages = function (t) {
        var stages = [];
        var currentDepth = [t];
        while (currentDepth.length > 0) {
            stages.unshift(currentDepth);
            currentDepth = currentDepth
                .map(function (currentDepthTask) {
                return currentDepthTask instanceof ModuleTask
                    ? [currentDepthTask.dependsOn]
                    : currentDepthTask.tasks.map(function (tasksTask) { return tasksTask instanceof ModuleTask ? tasksTask.dependsOn : tasksTask; });
            })
                .reduce(function (acc, tasks) { return acc.concat(tasks); }, [])
                .filter(function (item) { return item !== undefined; });
        }
        return stages.map(function (tasks) { return function () { return Promise.all(tasks.map(runTaskOrTasks)); }; });
    };
    process.on('SIGINT', killAllTasks);
    promiseSeries(createTaskExecutionStages(task))
        .then(killAllTasks, logFailureAndExit);
});
//# sourceMappingURL=builder-cli.js.map