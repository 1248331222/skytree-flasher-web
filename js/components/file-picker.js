// static/js/components/file-picker.js
// 前端文件管理器 — WebUSB 模式使用 File System Access API

var FilePicker = (function() {
    'use strict';

    var _modal = null;
    var _listEl = null;
    var _pathEl = null;
    var _currentPath = '/';     // 当前绝对路径
    var _history = [];          // 路径历史栈，用于返回上级
    var _options = null;        // 当前选择的配置
    var _resolveFn = null;
    var _rejectFn = null;

    // WebUSB 模式状态
    var _rootDirHandle = null;   // 根目录 handle（showDirectoryPicker 获得）
    var _currentDirHandle = null; // 当前目录 handle
    var _dirHandleStack = [];    // 目录 handle 栈，用于返回上级

    function _init() {
        _modal = document.getElementById('filePickerModal');
        _listEl = document.getElementById('fpFileList');
        _pathEl = document.getElementById('fpCurrentPath');
        if (!_modal || !_listEl || !_pathEl) return false;

        var backBtn = document.getElementById('fpBackBtn');
        if (backBtn) backBtn.onclick = _goUp;

        var refreshBtn = document.getElementById('fpRefreshBtn');
        if (refreshBtn) refreshBtn.onclick = function() {
            _loadDirWebusb(_currentDirHandle);
        };

        var closeBtn = document.getElementById('fpCloseBtn');
        var cancelBtn = document.getElementById('fpCancelBtn');
        if (closeBtn) closeBtn.onclick = _close;
        if (cancelBtn) cancelBtn.onclick = _close;
        _modal.addEventListener('click', function(e) { if (e.target === _modal) _close(); });

        var selectDirBtn = document.getElementById('fpSelectDirBtn');
        if (selectDirBtn) selectDirBtn.onclick = _selectCurrentDir;

        return true;
    }

    function _close() {
        if (_modal) _modal.style.display = 'none';
        if (_rejectFn) { _rejectFn(new Error('用户取消选择')); _rejectFn = null; }
        _resolveFn = null;
    }

    function _goUp() {
        // WebUSB 模式：通过 handle 栈返回上级
        if (_dirHandleStack.length > 0) {
            _dirHandleStack.pop(); // 移除当前
            if (_dirHandleStack.length > 0) {
                _currentDirHandle = _dirHandleStack[_dirHandleStack.length - 1];
            } else {
                _currentDirHandle = _rootDirHandle;
            }
            _currentPath = _currentPath.replace(/\/+$/, '').replace(/\/[^/]+$/, '') || '/';
            _loadDirWebusb(_currentDirHandle);
        }
    }

    function _selectCurrentDir() {
        if (!_currentPath) return;
        if (_resolveFn) {
            var result = {
                name: _currentPath.split('/').pop() || _currentPath,
                path: _currentPath,
                type: 'dir',
            };
            if (_currentDirHandle) {
                result.dirHandle = _currentDirHandle;
            }
            _resolveFn(result);
            _resolveFn = null;
        }
        if (_modal) _modal.style.display = 'none';
    }

    function _matchFilter(filename, filter) {
        if (!filter) return true;
        var name = filename.toLowerCase();
        var exts = filter.split(',').map(function(e) {
            return e.trim().replace(/^\*\./, '').replace(/^\./, '').toLowerCase();
        }).filter(function(e) { return e; });
        if (exts.length === 0) return true;
        return exts.some(function(ext) { return name.endsWith('.' + ext); });
    }

    // ===== WebUSB 模式：通过 FileSystemDirectoryHandle 浏览 =====
    async function _loadDirWebusb(dirHandle) {
        if (!_listEl) return;
        _listEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">加载中...</div>';

        try {
            var items = [];
            // 遍历目录条目
            for await (var entry of dirHandle.values()) {
                items.push({
                    name: entry.name,
                    type: entry.kind,  // 'file' or 'directory'
                    handle: entry,     // 保存 handle 供后续使用
                    size: 0,
                });
            }
            // 排序：目录在前，文件在后，各自按名称排序
            items.sort(function(a, b) {
                if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
                return a.name.localeCompare(b.name);
            });

            // 获取文件大小（仅对匹配过滤器的文件，避免遍历太多）
            for (var i = 0; i < items.length; i++) {
                if (items[i].type === 'file' && _matchFilter(items[i].name, _options ? _options.filter : '')) {
                    try {
                        var file = await items[i].handle.getFile();
                        items[i].size = file.size;
                    } catch(e) { /* ignore */ }
                }
            }

            _renderItems(items);
        } catch(e) {
            _listEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--accent-red);font-size:13px;">浏览失败: ' + _escapeHtml(e.message) + '</div>';
        }
    }

    // ===== 渲染文件列表（WebUSB 模式）=====
    function _renderItems(items) {
        if (items.length === 0) {
            _listEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">空目录</div>';
            return;
        }

        var html = '';
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var isDir = item.type === 'dir' || item.type === 'directory';
            var icon = isDir ? '📁' : '📄';
            var sizeText = (!isDir && item.size) ? _formatSize(item.size) : '';
            var clickable = '';

            if (isDir) {
                clickable = ' data-fp-dir="' + i + '"';
            } else {
                if (_matchFilter(item.name, _options ? _options.filter : '')) {
                    clickable = ' data-fp-file="' + i + '"';
                }
            }

            html += '<div class="fp-item' + (clickable ? ' fp-clickable' : ' fp-disabled') + '"' + clickable + '>' +
                '<span class="fp-icon">' + icon + '</span>' +
                '<span class="fp-name">' + _escapeHtml(item.name) + '</span>' +
                '<span class="fp-size">' + sizeText + '</span>' +
                '</div>';
        }
        _listEl.innerHTML = html;
        _listEl._fpItems = items;

        // 绑定目录点击
        var dirEls = _listEl.querySelectorAll('[data-fp-dir]');
        for (var d = 0; d < dirEls.length; d++) {
            dirEls[d].onclick = function() {
                var idx = parseInt(this.getAttribute('data-fp-dir'));
                var item = _listEl._fpItems[idx];
                if (!item) return;
                // WebUSB 模式：进入子目录
                _dirHandleStack.push(item.handle);
                _currentDirHandle = item.handle;
                _currentPath = _currentPath.replace(/\/+$/, '') + '/' + item.name;
                if (_pathEl) _pathEl.textContent = _currentPath;
                _loadDirWebusb(item.handle);
            };
        }

        // 绑定文件点击
        var fileEls = _listEl.querySelectorAll('[data-fp-file]');
        for (var f = 0; f < fileEls.length; f++) {
            fileEls[f].onclick = function() {
                var idx = parseInt(this.getAttribute('data-fp-file'));
                var item = _listEl._fpItems[idx];
                if (!item || !_resolveFn) return;
                var result = {
                    name: item.name,
                    path: _currentPath.replace(/\/+$/, '') + '/' + item.name,
                    type: 'file',
                    size: item.size || 0,
                };
                if (item.handle) {
                    result.fileHandle = item.handle;
                }
                _resolveFn(result);
                _resolveFn = null;
                if (_modal) _modal.style.display = 'none';
            };
        }
    }

    function _formatSize(bytes) {
        if (!bytes) return '';
        if (bytes < 1024) return bytes + 'B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'K';
        if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'M';
        return (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'G';
    }

    function _escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 打开文件管理器弹窗
     * @param {object} opts - { mode: 'file'|'dir', filter: '.bat,.cmd,.sh,.txt', webusb: true, rootDirHandle: handle }
     * @returns {Promise<{name, path, type, size?, fileHandle?, dirHandle?}>}
     */
    function pick(opts) {
        opts = opts || {};
        _options = opts;

        if (!_modal && !_init()) {
            return Promise.reject(new Error('文件管理器未初始化'));
        }

        var selectDirBtn = document.getElementById('fpSelectDirBtn');
        if (selectDirBtn) {
            selectDirBtn.style.display = (opts.mode === 'dir') ? '' : 'none';
        }

        var titleEl = document.getElementById('fpTitle');
        if (titleEl) {
            var title = opts.mode === 'dir' ? '选择目录' : '选择文件';
            title += '（WebUSB）';
            titleEl.textContent = title;
        }

        _history = [];
        _dirHandleStack = [];
        _modal.style.display = 'flex';

        return new Promise(function(resolve, reject) {
            _resolveFn = resolve;
            _rejectFn = reject;

            if (opts.rootDirHandle) {
                // WebUSB 模式：使用已存储的目录 handle
                _rootDirHandle = opts.rootDirHandle;
                _currentDirHandle = opts.rootDirHandle;
                _dirHandleStack = [opts.rootDirHandle];
                _currentPath = opts.rootDirHandle.name || '/';
                if (_pathEl) _pathEl.textContent = _currentPath;
                _loadDirWebusb(opts.rootDirHandle);
            } else {
                // WebUSB 模式但无 handle：需要请求目录权限
                _requestWebusbDir().then(function(handle) {
                    _rootDirHandle = handle;
                    _currentDirHandle = handle;
                    _dirHandleStack = [handle];
                    _currentPath = handle.name || '/';
                    if (_pathEl) _pathEl.textContent = _currentPath;
                    _loadDirWebusb(handle);
                }).catch(function(err) {
                    _close();
                    reject(err);
                });
            }
        });
    }

    /**
     * 请求 WebUSB 目录权限（showDirectoryPicker）
     */
    async function _requestWebusbDir() {
        var handle = await window.showDirectoryPicker();
        // 存储到全局，FileApi 会监听并持久化
        window._webusbRootDirHandle = handle;
        return handle;
    }

    return {
        pick: pick,
    };
})();
