// static/js/core/file-api.js
// 文件系统 API — WebUSB File System Access API + IndexedDB 持久化
// 项目已分离为纯 WebUSB 模式，移除后端 /api/fs/* 调用。

var FileApi = (function() {
    'use strict';

    var _webusbRootHandle = null;  // WebUSB 模式根目录 handle

    // ===== IndexedDB 持久化 FileSystemDirectoryHandle =====
    function _idbGet(dbName, storeName, key) {
        return new Promise(function(resolve, reject) {
            try {
                var req = indexedDB.open(dbName, 1);
                req.onupgradeneeded = function(e) {
                    e.target.result.createObjectStore(storeName);
                };
                req.onsuccess = function(e) {
                    var db = e.target.result;
                    var tx = db.transaction(storeName, 'readonly');
                    var store = tx.objectStore(storeName);
                    var getReq = store.get(key);
                    getReq.onsuccess = function() { resolve(getReq.result || null); };
                    getReq.onerror = function() { resolve(null); };
                };
                req.onerror = function() { resolve(null); };
            } catch(e) { resolve(null); }
        });
    }

    function _idbPut(dbName, storeName, key, value) {
        return new Promise(function(resolve, reject) {
            try {
                var req = indexedDB.open(dbName, 1);
                req.onupgradeneeded = function(e) {
                    e.target.result.createObjectStore(storeName);
                };
                req.onsuccess = function(e) {
                    var db = e.target.result;
                    var tx = db.transaction(storeName, 'readwrite');
                    var store = tx.objectStore(storeName);
                    store.put(value, key);
                    tx.oncomplete = function() { resolve(true); };
                    tx.onerror = function() { resolve(false); };
                };
                req.onerror = function() { resolve(false); };
            } catch(e) { resolve(false); }
        });
    }

    /**
     * 恢复已存储的 WebUSB 根目录 handle（页面刷新后调用）
     * 刷新后 read 权限通常可自动恢复，readwrite 需用户手势重新授权
     * 此函数优先恢复 handle 并检查 read 权限，readwrite 权限由调用方按需通过
     * window._ensureDirWritePermission() 在用户手势中请求
     */
    async function restoreWebusbRootHandle() {
        if (!window.showDirectoryPicker) return null;
        try {
            var handle = await _idbGet('webusb_fs', 'handles', 'rootDir');
            if (handle) {
                // 优先检查 readwrite 权限（如果已授权则直接返回）
                var permRW = await handle.queryPermission({ mode: 'readwrite' });
                if (permRW === 'granted') {
                    _webusbRootHandle = handle;
                    return handle;
                }
                // 检查 read 权限（刷新后通常可自动恢复）
                var permR = await handle.queryPermission({ mode: 'read' });
                if (permR === 'granted') {
                    _webusbRootHandle = handle;
                    return handle;
                }
                // 尝试请求 read 权限（可能在某些浏览器中不需要用户手势）
                var reqPerm = await handle.requestPermission({ mode: 'read' });
                if (reqPerm === 'granted') {
                    _webusbRootHandle = handle;
                    return handle;
                }
            }
        } catch(e) { /* ignore */ }
        return null;
    }

    /**
     * 存储根目录 handle 到 IndexedDB
     */
    async function _storeRootHandle(handle) {
        _webusbRootHandle = handle;
        await _idbPut('webusb_fs', 'handles', 'rootDir', handle);
    }

    // 监听 FilePicker 设置的全局 handle
    if (typeof window !== 'undefined') {
        try {
            Object.defineProperty(window, '_webusbRootDirHandle', {
                set: function(handle) {
                    if (handle) _storeRootHandle(handle);
                },
                get: function() { return _webusbRootHandle; },
                configurable: true,
            });
        } catch(e) { /* property already defined, ignore */ }
    }

    // --- 统一文件选择入口（WebUSB 模式） ---

    async function pickFile(opts) {
        opts = opts || {};
        var pathOnly = !!opts.pathOnly;

        // WebUSB 模式：优先使用 FilePicker + File System Access API
        if (typeof FilePicker !== 'undefined' && FilePicker.pick && window.showDirectoryPicker) {
            // 尝试恢复已存储的根目录 handle
            if (!_webusbRootHandle) {
                await restoreWebusbRootHandle();
            }
            var wbResult = await FilePicker.pick({
                mode: opts.mode || 'file',
                filter: opts.filter || '',
                webusb: true,
                rootDirHandle: _webusbRootHandle || undefined,
            });
            // 存储根目录 handle（FilePicker 可能通过 showDirectoryPicker 获取了新的）
            if (window._webusbRootDirHandle && !_webusbRootHandle) {
                _webusbRootHandle = window._webusbRootDirHandle;
            }

            // pathOnly 模式：返回 handle 和路径信息
            if (pathOnly) {
                if (wbResult.fileHandle) {
                    // 文件：获取 File 对象
                    var file = await wbResult.fileHandle.getFile();
                    wbResult.file = file;
                    wbResult.size = file.size;
                }
                return wbResult;
            }

            // 非 pathOnly：读取文件内容
            if (wbResult.fileHandle) {
                var file2 = await wbResult.fileHandle.getFile();
                var reader = new FileReader();
                return new Promise(function(resolve, reject) {
                    reader.onload = function() {
                        resolve({
                            name: wbResult.name,
                            content: reader.result,
                            size: file2.size,
                            path: wbResult.path || '',
                            fileHandle: wbResult.fileHandle,
                        });
                    };
                    reader.onerror = function() { reject(new Error('读取文件失败')); };
                    reader.readAsText(file2);
                });
            }
            return wbResult;
        }

        // 回退：浏览器原生 input[type=file]
        return _nativePickFile(opts);
    }

    function _nativePickFile(opts) {
        opts = opts || {};
        var pathOnly = !!opts.pathOnly;
        return new Promise(function(resolve, reject) {
            var input = document.createElement('input');
            input.type = 'file';
            if (opts.filter) input.accept = opts.filter;
            if (opts.multiple) input.multiple = true;
            if (opts.mode === 'dir') {
                input.webkitdirectory = true;
                input.directory = true;
                input.onchange = function() {
                    if (!input.files.length) return reject(new Error('未选择目录'));
                    var firstFile = input.files[0];
                    var relPath = firstFile.webkitRelativePath || firstFile.name;
                    var dirName = relPath.split('/')[0] || '';
                    var files = Array.from(input.files).map(function(f) {
                        return {
                            name: f.name,
                            size: f.size,
                            file: f,
                            path: '',
                            relativePath: f.webkitRelativePath || f.name
                        };
                    });
                    resolve({
                        type: 'dir',
                        name: dirName,
                        path: '',
                        files: files
                    });
                };
                input.click();
                return;
            }
            input.onchange = function() {
                if (!input.files.length) return reject(new Error('未选择文件'));
                var files = Array.from(input.files);
                if (files.length === 1) {
                    if (pathOnly) {
                        resolve({
                            name: files[0].name,
                            size: files[0].size,
                            file: files[0],
                            path: ''
                        });
                        return;
                    }
                    var reader = new FileReader();
                    reader.onload = function() {
                        resolve({
                            name: files[0].name,
                            content: reader.result,
                            size: files[0].size,
                            path: ''
                        });
                    };
                    reader.onerror = function() { reject(new Error('读取文件失败')); };
                    reader.readAsText(files[0]);
                } else {
                    resolve(files.map(function(f) {
                        return { name: f.name, size: f.size, file: f, path: '' };
                    }));
                }
            };
            input.click();
        });
    }

    /**
     * 通过 FileSystemFileHandle 获取 File/Blob（WebUSB 模式）
     */
    async function getFileFromHandle(fileHandle) {
        if (!fileHandle) return null;
        // 检查权限
        var perm = await fileHandle.queryPermission({ mode: 'read' });
        if (perm !== 'granted') {
            perm = await fileHandle.requestPermission({ mode: 'read' });
        }
        if (perm !== 'granted') throw new Error('文件访问权限被拒绝');
        return await fileHandle.getFile();
    }

    // ============ 路径解析（File System Access API） ============
    // 路径格式：rootHandleName/dir1/dir2/... 或 dir1/dir2/...
    // 如果第一个段与根目录 handle 名称匹配，则跳过

    /**
     * 将路径字符串解析为 FileSystemDirectoryHandle
     */
    async function _resolveDirHandle(dirPath) {
        var rootHandle = await restoreWebusbRootHandle();
        if (!rootHandle) throw new Error('未授权目录权限');

        var normalized = (dirPath || '').replace(/^\/+/, '');
        var segments = normalized.split('/').filter(Boolean);

        // 如果第一个段与根目录名匹配，跳过
        if (segments.length > 0 && segments[0] === rootHandle.name) {
            segments = segments.slice(1);
        }

        var currentHandle = rootHandle;
        for (var i = 0; i < segments.length; i++) {
            currentHandle = await currentHandle.getDirectoryHandle(segments[i], { create: false });
        }
        return currentHandle;
    }

    /**
     * 将路径字符串解析为 FileSystemFileHandle
     */
    async function _resolveFileHandle(filePath) {
        var rootHandle = await restoreWebusbRootHandle();
        if (!rootHandle) throw new Error('未授权目录权限');

        var normalized = (filePath || '').replace(/^\/+/, '');
        var segments = normalized.split('/').filter(Boolean);

        if (segments.length === 0) throw new Error('路径为空');

        // 如果第一个段与根目录名匹配，跳过
        if (segments[0] === rootHandle.name) {
            segments = segments.slice(1);
        }

        if (segments.length === 0) throw new Error('路径为空');

        // 遍历到父目录
        var currentHandle = rootHandle;
        for (var i = 0; i < segments.length - 1; i++) {
            currentHandle = await currentHandle.getDirectoryHandle(segments[i], { create: false });
        }

        // 获取文件 handle
        var fileName = segments[segments.length - 1];
        return await currentHandle.getFileHandle(fileName, { create: false });
    }

    /**
     * 简单通配符匹配（支持 * 和 ?）
     */
    function _matchPattern(name, pattern) {
        if (!pattern) return true;
        var regexStr = pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.');
        var regex = new RegExp('^' + regexStr + '$', 'i');
        return regex.test(name);
    }

    // ============ FileApi 文件系统方法（兼容原解析器） ============

    async function list(dirPath, pattern) {
        var dirHandle = await _resolveDirHandle(dirPath);
        var items = [];
        for await (var entry of dirHandle.values()) {
            if (pattern && !_matchPattern(entry.name, pattern)) continue;
            var item = {
                name: entry.name,
                path: (dirPath || '').replace(/\/+$/, '') + '/' + entry.name,
                type: entry.kind,
                size: 0,
            };
            if (entry.kind === 'file') {
                try {
                    var file = await entry.getFile();
                    item.size = file.size;
                } catch(e) {}
            }
            items.push(item);
        }
        return items;
    }

    async function exists(filePath) {
        try {
            await _resolveFileHandle(filePath);
            return true;
        } catch(e) {
            try {
                await _resolveDirHandle(filePath);
                return true;
            } catch(e2) {
                return false;
            }
        }
    }

    async function glob(pattern, basePath) {
        var dirHandle = await _resolveDirHandle(basePath);
        var matches = [];
        for await (var entry of dirHandle.values()) {
            if (entry.kind === 'file' && _matchPattern(entry.name, pattern)) {
                matches.push((basePath || '').replace(/\/+$/, '') + '/' + entry.name);
            }
        }
        return matches;
    }

    async function read(filePath, encoding) {
        var fileHandle = await _resolveFileHandle(filePath);
        var file = await fileHandle.getFile();
        if (encoding && /gbk|gb2312/i.test(encoding)) {
            var buffer = await file.arrayBuffer();
            var decoder = new TextDecoder(encoding.toLowerCase());
            return decoder.decode(buffer);
        }
        return await file.text();
    }

    async function readWithMeta(filePath, encoding) {
        var content = await read(filePath, encoding);
        return { content: content, abs_path: filePath };
    }

    async function readBinary(filePath) {
        var fileHandle = await _resolveFileHandle(filePath);
        var file = await fileHandle.getFile();
        var buffer = await file.arrayBuffer();
        return new Uint8Array(buffer);
    }

    async function mkdir(dirPath) {
        var rootHandle = await restoreWebusbRootHandle();
        if (!rootHandle) throw new Error('未授权目录权限');

        var normalized = (dirPath || '').replace(/^\/+/, '');
        var segments = normalized.split('/').filter(Boolean);
        if (segments.length > 0 && segments[0] === rootHandle.name) {
            segments = segments.slice(1);
        }

        var currentHandle = rootHandle;
        for (var i = 0; i < segments.length; i++) {
            currentHandle = await currentHandle.getDirectoryHandle(segments[i], { create: true });
        }
    }

    async function remove(filePath) {
        var rootHandle = await restoreWebusbRootHandle();
        if (!rootHandle) throw new Error('未授权目录权限');

        var normalized = (filePath || '').replace(/^\/+/, '');
        var segments = normalized.split('/').filter(Boolean);
        if (segments.length === 0) throw new Error('路径为空');
        if (segments[0] === rootHandle.name) segments = segments.slice(1);
        if (segments.length === 0) throw new Error('不能删除根目录');

        var currentHandle = rootHandle;
        for (var i = 0; i < segments.length - 1; i++) {
            currentHandle = await currentHandle.getDirectoryHandle(segments[i], { create: false });
        }
        await currentHandle.removeEntry(segments[segments.length - 1], { recursive: true });
    }

    async function copy(src, dst) {
        var srcFileHandle = await _resolveFileHandle(src);
        var file = await srcFileHandle.getFile();

        var rootHandle = await restoreWebusbRootHandle();
        if (!rootHandle) throw new Error('未授权目录权限');

        var normalized = (dst || '').replace(/^\/+/, '');
        var segments = normalized.split('/').filter(Boolean);
        if (segments.length > 0 && segments[0] === rootHandle.name) segments = segments.slice(1);
        if (segments.length === 0) throw new Error('目标路径为空');

        var currentHandle = rootHandle;
        for (var i = 0; i < segments.length - 1; i++) {
            currentHandle = await currentHandle.getDirectoryHandle(segments[i], { create: true });
        }

        var dstFileHandle = await currentHandle.getFileHandle(segments[segments.length - 1], { create: true });
        var writable = await dstFileHandle.createWritable();
        await writable.write(file);
        await writable.close();
    }

    async function move(src, dst) {
        await copy(src, dst);
        await remove(src);
    }

    return {
        pickFile: pickFile,
        getFileFromHandle: getFileFromHandle,
        restoreWebusbRootHandle: restoreWebusbRootHandle,
        _storeRootHandle: _storeRootHandle,
        _resolveFileHandle: _resolveFileHandle,
        _resolveDirHandle: _resolveDirHandle,
        // 文件系统方法（兼容原解析器）
        list: list,
        exists: exists,
        glob: glob,
        read: read,
        readWithMeta: readWithMeta,
        readBinary: readBinary,
        mkdir: mkdir,
        remove: remove,
        copy: copy,
        move: move,
    };
})();

// 注册模块
if (typeof Modules !== 'undefined' && Modules.register) {
    Modules.register('file-api', [], function() {
        console.log('[file-api] WebUSB 文件系统 API 已初始化');
        // WebUSB 模式下尝试恢复目录 handle
        FileApi.restoreWebusbRootHandle().then(function(h) {
            if (h) console.log('[file-api] 已恢复 WebUSB 目录访问权限:', h.name);
        });
        return true;
    });
}
