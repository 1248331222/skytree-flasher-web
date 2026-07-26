// static/js/core/parser-runner.js
// 解析器加载器 + async generator 驱动
// 纯前端模式：解析器来源为两个 JXQ 目录
//   1. 项目根目录 JXQ/（随项目分发，fetch 加载，不可卸载）
//   2. 已授权工作目录 JXQ/（用户安装，File System Access API 加载，可卸载）
// 同时保留 localStorage 作为兼容降级

var ParserRunner = (function() {
    'use strict';

    var _parsersCache = {};  // filename -> module
    var LOCAL_STORAGE_KEY = 'webusb_local_parsers'; // localStorage 中解析器列表的 key（兼容旧版）
    var LOCAL_CONTENT_PREFIX = 'webusb_parser_content_'; // localStorage 中解析器代码内容的 key 前缀

    // 内置解析器清单缓存
    var _builtinListCache = null;
    // 工作目录解析器清单缓存
    var _installedListCache = null;

    // ============ localStorage 兼容存储（旧版迁移用） ============

    function _getLocalParserList() {
        try {
            var raw = localStorage.getItem(LOCAL_STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch(e) {
            return [];
        }
    }

    function _saveLocalParserList(list) {
        try {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(list));
        } catch(e) {
            console.error('[parser-runner] 保存解析器列表到 localStorage 失败:', e);
        }
    }

    function _getLocalParserContent(filename) {
        try {
            return localStorage.getItem(LOCAL_CONTENT_PREFIX + filename) || '';
        } catch(e) {
            return '';
        }
    }

    function _saveLocalParserContent(filename, content) {
        try {
            localStorage.setItem(LOCAL_CONTENT_PREFIX + filename, content);
        } catch(e) {
            console.error('[parser-runner] 保存解析器内容到 localStorage 失败:', e);
            throw new Error('本地存储空间不足，无法保存解析器');
        }
    }

    function _removeLocalParser(filename) {
        try {
            localStorage.removeItem(LOCAL_CONTENT_PREFIX + filename);
            var list = _getLocalParserList();
            list = list.filter(function(p) { return p.filename !== filename; });
            _saveLocalParserList(list);
        } catch(e) {
            console.error('[parser-runner] 删除本地解析器失败:', e);
        }
    }

    // ============ 来源1：项目根目录 JXQ/（内置解析器，fetch 加载） ============

    /**
     * 列出项目根目录 JXQ/ 下的 .js 文件
     * 通过 fetch JXQ/ 目录下的 manifest.json 获取列表
     * 如果 manifest.json 不存在，尝试 fetch 常见解析器文件名
     */
    async function _listBuiltinParsers() {
        if (_builtinListCache) return _builtinListCache;
        var parsers = [];
        try {
            // 尝试读取 JXQ/manifest.json
            var resp = await fetch('JXQ/manifest.json', { cache: 'no-cache' });
            if (resp.ok) {
                var manifest = await resp.json();
                if (Array.isArray(manifest)) {
                    var fetchPromises = manifest.map(function(name) {
                        var filename = name.endsWith('.js') ? name : name + '.js';
                        return fetch('JXQ/' + filename, { method: 'HEAD', cache: 'no-cache' })
                            .then(function(r) {
                                return {
                                    filename: filename,
                                    name: name.replace(/\.js$/i, ''),
                                    source: 'builtin',
                                    builtin: true,
                                    size: r.ok ? (parseInt(r.headers.get('content-length'), 10) || 0) : 0,
                                };
                            })
                            .catch(function() {
                                return {
                                    filename: filename,
                                    name: name.replace(/\.js$/i, ''),
                                    source: 'builtin',
                                    builtin: true,
                                    size: 0,
                                };
                            });
                    });
                    parsers = await Promise.all(fetchPromises);
                }
            }
        } catch(e) {
            // manifest.json 不存在，静默处理
        }
        _builtinListCache = parsers;
        return parsers;
    }

    /**
     * 从项目根目录 JXQ/ 读取解析器代码
     */
    async function _readBuiltinParser(filename) {
        try {
            var resp = await fetch('JXQ/' + filename, { cache: 'no-cache' });
            if (resp.ok) {
                return await resp.text();
            }
        } catch(e) { /* ignore */ }
        return '';
    }

    // ============ 来源2：已授权工作目录 JXQ/（用户安装，File System Access API） ============

    /**
     * 获取工作目录中的 JXQ 目录 handle
     * 工作目录 = 已授权根目录/123456/
     * JXQ 目录 = 工作目录/JXQ/
     */
    async function _getInstalledJxqDir() {
        if (typeof FileApi === 'undefined' || !FileApi.restoreWebusbRootHandle) return null;
        var rootHandle = await FileApi.restoreWebusbRootHandle();
        if (!rootHandle) return null;
        try {
            var dir123456 = await rootHandle.getDirectoryHandle('123456', { create: false });
            return await dir123456.getDirectoryHandle('JXQ', { create: false });
        } catch(e) {
            return null;
        }
    }

    /**
     * 列出工作目录 JXQ/ 下的 .js 文件
     */
    async function _listInstalledParsers() {
        var jxqDir = await _getInstalledJxqDir();
        if (!jxqDir) return [];
        var parsers = [];
        try {
            for await (var entry of jxqDir.values()) {
                if (entry.kind === 'file' && entry.name.endsWith('.js')) {
                    var fileSize = 0;
                    try {
                        var file = await entry.getFile();
                        fileSize = file.size;
                    } catch(e) { /* ignore */ }
                    parsers.push({
                        filename: entry.name,
                        name: entry.name.replace(/\.js$/i, ''),
                        source: 'installed',
                        builtin: false,
                        size: fileSize,
                        fileHandle: entry,
                    });
                }
            }
        } catch(e) { /* ignore */ }
        return parsers;
    }

    /**
     * 从工作目录 JXQ/ 读取解析器代码
     */
    async function _readInstalledParser(filename) {
        var jxqDir = await _getInstalledJxqDir();
        if (!jxqDir) return '';
        try {
            var fileHandle = await jxqDir.getFileHandle(filename);
            var file = await fileHandle.getFile();
            return await file.text();
        } catch(e) { return ''; }
    }

    /**
     * 安装解析器到工作目录 JXQ/
     */
    async function _installToWorkDir(filename, content) {
        if (typeof FileApi === 'undefined' || !FileApi.restoreWebusbRootHandle) {
            throw new Error('未授权目录权限，无法安装');
        }
        var rootHandle = await FileApi.restoreWebusbRootHandle();
        if (!rootHandle) throw new Error('未授权目录权限，无法安装');
        // 确保 123456/JXQ 目录存在
        var dir123456 = await rootHandle.getDirectoryHandle('123456', { create: true });
        var jxqDir = await dir123456.getDirectoryHandle('JXQ', { create: true });
        // 写入文件
        var fileHandle = await jxqDir.getFileHandle(filename, { create: true });
        var writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
        // 清除缓存
        _installedListCache = null;
    }

    /**
     * 从工作目录 JXQ/ 卸载解析器
     */
    async function _uninstallFromWorkDir(filename) {
        var jxqDir = await _getInstalledJxqDir();
        if (!jxqDir) throw new Error('JXQ 目录不存在');
        await jxqDir.removeEntry(filename);
        _installedListCache = null;
    }

    // ============ 解析器列表管理（合并两个来源） ============

    async function listParsers() {
        // 并行加载两个来源
        var builtinP = _listBuiltinParsers();
        var installedP = _listInstalledParsers();

        var builtin = await builtinP;
        var installed = await installedP;

        // 合并：安装目录的同名解析器覆盖内置解析器
        var merged = [];
        var installedNames = {};
        for (var i = 0; i < installed.length; i++) {
            installedNames[installed[i].filename] = true;
            merged.push(installed[i]);
        }
        for (var j = 0; j < builtin.length; j++) {
            if (!installedNames[builtin[j].filename]) {
                merged.push(builtin[j]);
            }
        }

        // 如果两个来源都为空，降级到 localStorage（兼容旧版）
        if (merged.length === 0) {
            var local = _getLocalParserList();
            for (var k = 0; k < local.length; k++) {
                local[k].source = 'local';
                local[k].builtin = false;
                merged.push(local[k]);
            }
        }

        return merged;
    }

    // ============ 动态加载解析器 ============

    async function loadParser(filename) {
        if (_parsersCache[filename]) return _parsersCache[filename];

        var code = '';

        // 优先从安装目录读取
        code = await _readInstalledParser(filename);
        if (!code) {
            // 其次从内置目录读取
            code = await _readBuiltinParser(filename);
        }
        if (!code) {
            // 最后降级到 localStorage
            code = _getLocalParserContent(filename);
        }

        if (!code) {
            throw new Error('解析器 ' + filename + ' 不存在或内容为空');
        }

        // CommonJS 兼容：检测 module.exports 或 exports.xxx 语法
        // 如果没有 export 关键字，包装为 ES module
        if (!/\bexport\s+(default|function|const|let|var|class)\b/.test(code)) {
            // 可能是 CommonJS，包装转换
            code = 'var module = { exports: {} }; var exports = module.exports;\n' +
                   code + '\n' +
                   'export default module.exports;\n' +
                   'export const __cjs = true;\n';
        }

        // 使用 Blob URL 动态加载为 ES module
        var blob = new Blob([code], { type: 'text/javascript' });
        var url = URL.createObjectURL(blob);
        try {
            var mod = await import(url);
            _parsersCache[filename] = mod;
            return mod;
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    // ============ 根据分类结果匹配解析器 ============

    async function findParser(classifyKey) {
        var parsers = await listParsers();
        // 精确匹配：解析器文件名 == classifyKey + '.js'
        var exact = parsers.find(function(p) {
            return p.filename === classifyKey + '.js';
        });
        if (exact) return exact.filename;

        // 无精确匹配 → 返回 null（不做降级）
        return null;
    }

    // ============ 运行解析器（驱动 async generator） ============

    /**
     * 运行解析器
     * @param {string} parserFilename - 解析器文件名
     * @param {string} content - 脚本内容
     * @param {object} options - { fileApi, extraArgs, onStep, onChoice, romDir }
     * @returns {object} { steps, hasScriptParams, scriptParamHint }
     */
    async function run(parserFilename, content, options) {
        options = options || {};
        var mod = await loadParser(parserFilename);

        // 查找 parse 函数：支持多种导出方式
        var parseFn = mod.parse || (mod.default && typeof mod.default === 'function' ? mod.default : null);
        if (!parseFn && mod.default && typeof mod.default.parse === 'function') {
            parseFn = mod.default.parse;
        }

        if (typeof parseFn !== 'function') {
            throw new Error('解析器 ' + parserFilename + ' 没有导出 parse 函数。请使用 export function parse 或 module.exports = { parse: function... }');
        }

        var steps = [];
        var hasScriptParams = false;
        var scriptParamHint = '';

        // 注入 fileApi
        var fileApi = options.fileApi || FileApi;

        // 调用解析器
        var ctx = {
            fileApi: fileApi,
            extraArgs: options.extraArgs || '',
            romDir: options.romDir || '',
            scriptPath: options.scriptPath || '',
        };

        var result;
        try {
            result = parseFn(content, ctx);
        } catch (e) {
            throw new Error('解析器 ' + parserFilename + ' 内部错误: ' + e.message);
        }

        // 判断是否是 async generator
        if (result && typeof result[Symbol.asyncIterator] === 'function') {
            // async generator 模式：逐步产出步骤，支持交互
            var gen = result;
            while (true) {
                var next = await gen.next();
                if (next.done) break;
                var value = next.value;

                if (!value) continue;

                if (value.type === 'choice' || value.type === 'confirm') {
                    // 交互式：暂停解析，等待用户选择
                    if (typeof options.onChoice === 'function') {
                        var userChoice = await options.onChoice(value);
                        await gen.next(userChoice);
                    } else {
                        throw new Error('解析器需要用户选择，但未提供 onChoice 回调');
                    }
                } else if (value.type === 'step') {
                    var step = value.step || value;
                    steps.push(step);
                    if (typeof options.onStep === 'function') options.onStep(step, steps.length);
                }
            }
        } else if (result && typeof result.then === 'function') {
            // Promise 模式：等待完成
            var resolved = await result;
            if (Array.isArray(resolved)) {
                steps = resolved;
            } else if (resolved && resolved.steps) {
                steps = resolved.steps;
                hasScriptParams = !!resolved.hasScriptParams;
                scriptParamHint = resolved.scriptParamHint || '';
            }
        } else if (Array.isArray(result)) {
            steps = result;
        } else if (result && result.steps) {
            steps = result.steps;
            hasScriptParams = !!result.hasScriptParams;
            scriptParamHint = result.scriptParamHint || '';
        }

        return {
            steps: steps,
            hasScriptParams: hasScriptParams,
            scriptParamHint: scriptParamHint,
        };
    }

    // ============ 解析器安装/卸载 ============

    async function installParser(formData) {
        var file = formData.get('file');
        var force = formData.get('force') === 'true';
        if (!file) return { success: false, error: '未提供文件' };

        var filename = file.name;
        var content = await file.text();

        // 检查是否已存在（内置解析器不可覆盖）
        var existing = await listParsers();
        var found = existing.find(function(p) { return p.filename === filename; });
        if (found) {
            if (found.builtin) {
                return { success: false, error: '内置解析器不可覆盖安装' };
            }
            if (!force) {
                return { success: false, error: 'overwrite_confirm', message: '解析器 ' + filename + ' 已存在，是否覆盖安装？' };
            }
        }

        // 优先安装到工作目录 JXQ/
        try {
            await _installToWorkDir(filename, content);
            clearCache(filename);
            return { success: true, message: '解析器 ' + filename + ' 已安装到工作目录' };
        } catch(e) {
            // 工作目录不可用，降级到 localStorage
            console.warn('[parser-runner] 安装到工作目录失败，降级到 localStorage:', e.message);
        }

        // localStorage 降级
        _saveLocalParserContent(filename, content);
        var localList = _getLocalParserList();
        var localExisting = localList.find(function(p) { return p.filename === filename; });
        if (localExisting) {
            localExisting.size = content.length;
            localExisting.installed_at = new Date().toISOString();
        } else {
            localList.push({
                filename: filename,
                name: filename.replace(/\.js$/i, ''),
                size: content.length,
                installed_at: new Date().toISOString(),
            });
        }
        _saveLocalParserList(localList);
        clearCache(filename);
        return { success: true, message: '解析器 ' + filename + ' 已安装到本地存储' };
    }

    async function uninstallParser(filename) {
        // 检查是否为内置解析器
        var parsers = await listParsers();
        var found = parsers.find(function(p) { return p.filename === filename; });
        if (found && found.builtin) {
            return { success: false, error: '内置解析器不可卸载' };
        }

        // 从工作目录卸载
        try {
            await _uninstallFromWorkDir(filename);
            clearCache(filename);
            return { success: true, message: '解析器 ' + filename + ' 已卸载' };
        } catch(e) {
            // 降级到 localStorage
        }

        // localStorage 降级
        _removeLocalParser(filename);
        clearCache(filename);
        return { success: true, message: '解析器 ' + filename + ' 已卸载' };
    }

    async function installFromUrl(url, filename) {
        try {
            var dlResp = await fetch(url);
            if (!dlResp.ok) throw new Error('下载失败: HTTP ' + dlResp.status);
            var content = await dlResp.text();

            // 优先安装到工作目录
            try {
                await _installToWorkDir(filename, content);
                clearCache(filename);
                return { success: true, message: '解析器 ' + filename + ' 已从 URL 安装到工作目录' };
            } catch(e) {
                // 降级到 localStorage
            }

            _saveLocalParserContent(filename, content);
            var list = _getLocalParserList();
            var existing = list.find(function(p) { return p.filename === filename; });
            if (existing) {
                existing.size = content.length;
                existing.installed_at = new Date().toISOString();
            } else {
                list.push({
                    filename: filename,
                    name: filename.replace(/\.js$/i, ''),
                    size: content.length,
                    installed_at: new Date().toISOString(),
                });
            }
            _saveLocalParserList(list);
            clearCache(filename);
            return { success: true, message: '解析器 ' + filename + ' 已从 URL 安装到本地存储' };
        } catch(e) {
            return { success: false, error: e.message };
        }
    }

    async function installFromWebdav(filename, webdavConfig) {
        try {
            var cfg = webdavConfig || {};
            var baseUrl = cfg.url || '';
            var user = cfg.user || '';
            var pass = cfg.pass || '';
            var remotePath = cfg.path || ('/' + filename);
            if (!baseUrl) throw new Error('未配置 WebDAV 地址');

            var fullUrl = baseUrl.replace(/\/+$/, '') + (remotePath.startsWith('/') ? remotePath : '/' + remotePath);
            var authHeader = 'Basic ' + btoa(user + ':' + pass);

            var dlResp = await fetch(fullUrl, {
                headers: { 'Authorization': authHeader },
            });
            if (!dlResp.ok) throw new Error('WebDAV 下载失败: HTTP ' + dlResp.status);
            var content = await dlResp.text();

            // 优先安装到工作目录
            try {
                await _installToWorkDir(filename, content);
                clearCache(filename);
                return { success: true, message: '解析器 ' + filename + ' 已从 WebDAV 安装到工作目录' };
            } catch(e) {
                // 降级到 localStorage
            }

            _saveLocalParserContent(filename, content);
            var list = _getLocalParserList();
            var existing = list.find(function(p) { return p.filename === filename; });
            if (existing) {
                existing.size = content.length;
                existing.installed_at = new Date().toISOString();
            } else {
                list.push({
                    filename: filename,
                    name: filename.replace(/\.js$/i, ''),
                    size: content.length,
                    installed_at: new Date().toISOString(),
                });
            }
            _saveLocalParserList(list);
            clearCache(filename);
            return { success: true, message: '解析器 ' + filename + ' 已从 WebDAV 安装到本地存储' };
        } catch(e) {
            return { success: false, error: e.message };
        }
    }

    async function webdavListParsers(webdavConfig) {
        try {
            var cfg = webdavConfig || {};
            var baseUrl = cfg.url || '';
            var user = cfg.user || '';
            var pass = cfg.pass || '';
            var dirPath = cfg.dir || '/';
            if (!baseUrl) throw new Error('未配置 WebDAV 地址');

            var fullUrl = baseUrl.replace(/\/+$/, '') + (dirPath.startsWith('/') ? dirPath : '/' + dirPath);
            var authHeader = 'Basic ' + btoa(user + ':' + pass);

            var propResp = await fetch(fullUrl, {
                method: 'PROPFIND',
                headers: {
                    'Authorization': authHeader,
                    'Depth': '1',
                    'Content-Type': 'application/xml',
                },
                body: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><displayname/><getcontentlength/><resourcetype/></prop></propfind>',
            });
            if (!propResp.ok) throw new Error('WebDAV PROPFIND 失败: HTTP ' + propResp.status);
            var xmlText = await propResp.text();

            // 简单解析 XML 提取 .js 文件
            var parser = new DOMParser();
            var doc = parser.parseFromString(xmlText, 'text/xml');
            var responses = doc.getElementsByTagNameNS('DAV:', 'response');
            var files = [];
            for (var i = 0; i < responses.length; i++) {
                var hrefEl = responses[i].getElementsByTagNameNS('DAV:', 'href');
                var nameEl = responses[i].getElementsByTagNameNS('DAV:', 'displayname');
                var sizeEl = responses[i].getElementsByTagNameNS('DAV:', 'getcontentlength');
                var href = hrefEl.length > 0 ? hrefEl[0].textContent : '';
                var name = nameEl.length > 0 ? nameEl[0].textContent : '';
                var size = sizeEl.length > 0 ? parseInt(sizeEl[0].textContent, 10) : 0;
                if (name && /\.js$/i.test(name)) {
                    files.push({ filename: name, path: href, size: size });
                }
            }
            return { success: true, files: files };
        } catch(e) {
            return { success: false, error: e.message };
        }
    }

    // 强制刷新解析器缓存
    function clearCache(filename) {
        if (filename) {
            delete _parsersCache[filename];
        } else {
            _parsersCache = {};
        }
        _builtinListCache = null;
        _installedListCache = null;
    }

    return {
        listParsers: listParsers,
        loadParser: loadParser,
        findParser: findParser,
        run: run,
        installParser: installParser,
        uninstallParser: uninstallParser,
        installFromUrl: installFromUrl,
        installFromWebdav: installFromWebdav,
        webdavListParsers: webdavListParsers,
        clearCache: clearCache,
    };
})();

if (typeof Modules !== 'undefined' && Modules.register) {
    Modules.register('parser-runner', ['file-api'], function() {
        console.log('[parser-runner] 解析器运行器已初始化（JXQ 双目录模式）');
        return true;
    });
}
