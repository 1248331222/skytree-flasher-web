// flash_tool/static/js/custom_flash.js
// ============ 自定义单刷 ============
let customImgSourceEl, customRomSelectEl, customImgSelectEl;

function updateSingleImageUI() {
    const src = customImgSourceEl ? customImgSourceEl.value : 'local';
    if (customRomSelectEl) {
        customRomSelectEl.style.display = src === 'rom' ? '' : 'none';
        if (src !== 'rom') customRomSelectEl.value = '';
    }
}

async function handleCustomImgSourceChange() {
    updateSingleImageUI();
    if (customImgSelectEl) customImgSelectEl.innerHTML = '<option value="">选择镜像文件</option>';
    if (customImgSourceEl && customImgSourceEl.value === 'rom') {
        if (customRomSelectEl) customRomSelectEl.value = '';
        await loadCustomRomList();
        if (customImgSelectEl) customImgSelectEl.innerHTML = '<option value="">请先选择已解压刷机包</option>';
    } else {
        await loadProjectImages();
    }
}

async function loadCustomRomList() {
    // WebUSB 模式不依赖后端 ROM 列表
    if (customRomSelectEl) customRomSelectEl.innerHTML = '<option value="">WebUSB 模式无服务端刷机包</option>';
}

async function handleCustomRomChange() {
    const _cis = document.getElementById('customImgSelect'); if(_cis) _cis.innerHTML = '<option value="">选择镜像文件</option>';
    await loadCustomRomImages();
    updateBtnState();
}

async function loadCustomRomImages() {
    const rn = customRomSelectEl ? customRomSelectEl.value : '';
    if (!rn) {
        const _cis2 = document.getElementById('customImgSelect'); if(_cis2) _cis2.innerHTML = '<option value="">请先选择已解压刷机包</option>';
        return;
    }
    // WebUSB 模式不依赖后端 ROM 镜像列表
    const _cis = document.getElementById('customImgSelect');
    if (_cis) _cis.innerHTML = '<option value="">WebUSB 模式无服务端镜像列表</option>';
}

function handleAddCustom() {
    const partNameEl = document.getElementById('customPartName');
    const imgSelectEl = document.getElementById('customImgSelect');
    const paramEl = document.getElementById('customParam');
    if (!partNameEl || !imgSelectEl) { writeLog('界面元素缺失，无法添加单刷任务', 'err'); return; }
    const partRaw = partNameEl.value.trim();
    const img = imgSelectEl.value;
    const pms = paramEl ? paramEl.value.trim() : '';
    const source = customImgSourceEl ? customImgSourceEl.value : 'local';

    if (!partRaw) return writeLog('请填写分区名', 'err');
    if (!img) return writeLog('请选择镜像文件', 'err');

    const part = formatPartition(partRaw);
    const romName = customRomSelectEl ? customRomSelectEl.value : '';
    customPartList.push({part, img, param: pms, rawPart: partRaw, mode: 'webusb', source, romName});
    renderCustomList();

    partNameEl.value = '';
    if (paramEl) paramEl.value = '';
    writeLog(`添加单刷：${part}`, 'info');
}



function renderCustomList() {
    const el = document.getElementById('customPartList');
    if (!el) return;
    el.innerHTML = '';

    if (customPartList.length === 0) {
        el.innerHTML = '<div class="empty-state">暂无单刷任务。填写分区名并选择镜像后添加。</div>';
        return;
    }
    
    customPartList.forEach((item, idx) => {
        const d = document.createElement('div');
        d.className = 'custom-item';
        const singleUsable = webusbFastbootReady;
        const srcLabel = item.source === 'rom' ? '刷机包' : '手机目录';
        d.innerHTML = `<span>${escHtml(item.part)} | ${srcLabel}:${escHtml(item.img)} ${escHtml(item.param||'')}</span><div><button class="btn small flash-single btn-primary" data-idx="${idx}" ${!singleUsable?'disabled':''}>立即刷写</button><button class="btn small danger del-single" data-idx="${idx}">删除</button></div>`;
        el.appendChild(d);
    });
    
    el.querySelectorAll('.flash-single').forEach(b => {
        b.onclick = async e => {
            const idx = +e.target.dataset.idx;
            const it = customPartList[idx];
            
            const dangerous = ['bootloader', 'xbl', 'modem', 'persist'].some(p => it.part.toLowerCase().includes(p));
            if (dangerous) {
                showConfirm('高危分区警告', `刷「${it.part}」可能导致设备变砖，确认继续？`, () => doFlashSingle(it, true));
                return;
            }
            doFlashSingle(it, false);
        };
    });
    
    el.querySelectorAll('.del-single').forEach(b => {
        b.onclick = e => {
            customPartList.splice(+e.target.dataset.idx, 1);
            renderCustomList();
        };
    });
}

async function doFlashSingle(it, allowDangerous) {
    if (blUnlocked === false) {
        setModuleStatus('single', '单分区刷写状态：Bootloader 未解锁，已阻止刷写。', 'err');
        writeLog('Bootloader 未解锁，已阻止单分区刷写', 'err');
        showErrorCard('Bootloader 未解锁', '请先解锁 Bootloader 后再刷写分区。');
        return;
    }
    writeLog(`启动刷写：${it.part}`);
    setModuleStatus('single', `准备开始刷写分区：${it.part}`, 'warn');
    showModuleProgress('single', `准备刷写 ${it.part}`);
    showProgress(`刷写 ${it.part}`);

    if (!webusbFastbootReady || !webusbFastboot) {
        hideProgress();
        hideModuleProgress('single');
        setModuleStatus('single', 'Fastboot设备未连接，请先在顶部胶囊点击设备检测连接。', 'err');
        return;
    }
    try {
        setModuleStatus('single', `WebUSB正在读取镜像并刷写分区：${it.part}`, 'info');
        const bytes = await resolveWebUsbImageBytes(it.img, {source: it.source, romName: it.romName});
        await webusbFastboot.flash(it.part, bytes, p => {
            updateProgress(p, `WebUSB刷写 ${it.part}`);
            updateModuleProgress('single', p, `WebUSB刷写 ${it.part}`);
        });
        hideProgress();
        updateModuleProgress('single', 100, '已刷入');
        setModuleStatus('single', `WebUSB已刷入分区：${it.part}`, 'ok');
        writeLog(`WebUSB单刷完成：${it.part}`, 'ok');
        showToast(`已刷入分区：${it.part}`);
    } catch(e) {
        hideProgress();
        hideModuleProgress('single');
        setModuleStatus('single', `WebUSB刷写失败：${e.message}`, 'err');
        writeLog('WebUSB刷写失败：' + e.message, 'err');
        const diagnosis = await diagnoseFastbootError(e.message);
        if (diagnosis) showErrorCard(e.message, diagnosis);
    }
}

async function fetchImageBytes(source, image, romName = '') {
    let url;
    if (source === 'path') {
        // 绝对路径模式：使用 path_blob 接口，后端校验路径安全性
        url = `/api/image/path_blob?path=${encodeURIComponent(image)}`;
    } else {
        url = `/api/image/blob?source=${encodeURIComponent(source)}&image=${encodeURIComponent(image)}&rom_name=${encodeURIComponent(romName || '')}`;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error('读取镜像失败：' + await res.text());
    // 返回 Blob 而非 Uint8Array，新 fastboot.mjs 支持流式传输，避免大文件内存爆炸
    return await res.blob();
}

async function resolveWebUsbImageBytes(imageName, options = {}) {
    const forBatch = !!options.forBatch;
    const validateOnly = !!options.validateOnly;
    const source = options.source || 'local';
    const romName = options.romName || '';
    
    // local / rom 模式：通过后端 API 读取镜像
    if (source === 'local' || source === 'rom') {
        return await fetchImageBytes(source, imageName, romName);
    }
    
    // 兼容旧逻辑（线刷脚本批量刷写）
    const normalized = (imageName || '').replace(/\\/g, '/');
    if (webusbScriptBaseDir && normalized) {
        const res = await fetch(`/api/image/path_blob?path=${encodeURIComponent(webusbScriptBaseDir + '/' + normalized)}`);
        if (validateOnly && res.ok) return new Uint8Array();
        if (res.ok) return await res.blob();  // Blob 流式传输
    }
    if (forBatch) {
        const findUrl = `/api/image/find_blob?image=${encodeURIComponent(normalized)}${validateOnly ? '&validate=1' : ''}`;
        const found = await fetch(findUrl);
        if (found.ok) {
            if (validateOnly) return new Uint8Array();
            return await found.blob();  // Blob 流式传输
        }
        let detail = '';
        try {
            const err = await found.json();
            detail = err.error || '';
        } catch(e) {
            detail = await found.text();
        }
        throw new Error(`未找到镜像：${imageName}${detail ? '；' + detail : ''}`);
    }
    return await fetchImageBytes('rom', imageName, document.getElementById('romSelect').value);
}

// ============ 补充函数 ============
function adbCmd(name) {
    return name.charCodeAt(0) | (name.charCodeAt(1) << 8) | (name.charCodeAt(2) << 16) | (name.charCodeAt(3) << 24);
}

function adbCommandToService(args) {
    const cmd = args[0] || '';
    if (cmd === 'devices') return {local: true, text: webusbAdbReady ? 'webusb-adb\tdevice' : ''};
    if (cmd === 'reboot') return {service: args.length > 1 ? `reboot:${args[1]}` : 'reboot:'};
    if (cmd === 'shell') return {service: `shell:${args.slice(1).join(' ')}`};
    if (cmd === 'get-state') return {service: 'host:get-state'};
    return {service: `shell:${args.join(' ')}`};
}

function parseClientFastbootScript(content) {
    const steps = [];
    const lines = content.split(/\r?\n/);
    for (const raw of lines) {
        let line = raw.trim();
        if (!line) continue;
        // 去掉 @ 前缀
        if (line.startsWith('@')) line = line.substring(1).trim();
        if (!line || line.startsWith('#') || line.startsWith('::') || /^rem\s/i.test(line)) continue;
        if (/^(echo|pause|sleep|export|set|call|goto|exit)\s/i.test(line)) continue;
        // 替换 fastboot 变量引用
        line = line.replace(/["']?\$\{?(FASTBOOT|fastboot)\}?["']?/g, 'fastboot');
        line = line.replace(/["']?%(FASTBOOT|fastboot)%["']?/gi, 'fastboot');
        const m = line.match(/(?:^|[\s;&|])(?:sudo\s+)?(?:"[^"]*fastboot(?:\.exe)?"|'(?:[^']*fastboot(?:\.exe)?[^']*)'|(?:[\w%~.$/\\:-]+[\/\\])?fastboot(?:\.exe)?)\s+(\S+)(?:\s+(.+))?/i);
        if (!m) continue;
        const cmd = m[1].toLowerCase();
        const args = (m[2] || '').trim().split(/\s+/).filter(Boolean);
        if (cmd === 'flash' && args.length >= 2 && args[1].toLowerCase().endsWith('.img')) {
            let imgPath = args[1].replace(/\\/g, '/');
            // 清理 Windows 批处理变量 %~dp0 %~d0 %CD% 等
            imgPath = imgPath.replace(/%~[a-zA-Z]0/gi, '').replace(/%CD%/gi, '').replace(/%[\w]+%/g, '');
            imgPath = imgPath.replace(/\.\//g, '').replace(/\/+/g, '/').replace(/^\//, '');
            steps.push({type: 'flash', part: args[0], fileName: imgPath, params: args.slice(2).join(' '), raw});
        } else if (cmd === 'erase' && args[0]) {
            steps.push({type: 'erase', part: args[0], raw});
        } else if (cmd === 'set_active' && args[0]) {
            steps.push({type: 'set_active', part: args[0], raw});
        } else if (cmd === 'reboot') {
            steps.push({type: 'reboot', part: args[0] || 'system', raw});
        } else if (cmd === 'oem' || cmd === 'flashing') {
            steps.push({type: 'oem', part: args.join(' '), raw});
        }
    }
    return steps;
}

function parseFastbootArgs(input) {
    let cmd = input.trim();
    if (!cmd) return [];
    if (cmd.toLowerCase().startsWith('fastboot ')) {
        cmd = cmd.slice(9).trim();
    } else if (cmd.toLowerCase().startsWith('adb ')) {
        cmd = cmd.slice(4).trim();
    }
    const matches = cmd.match(/"([^"]*)"|'([^']*)'|[^\s]+/g) || [];
    return matches.map(s => {
        if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
            return s.slice(1, -1);
        }
        return s;
    });
}

function localizeFastbootResult(tool, args, text) {
    if (tool !== 'fastboot') return text;
    const a0 = String(args[0] || '').toLowerCase();
    const a1 = String(args[1] || '').toLowerCase();
    if (a0 === 'getvar' && a1 === 'product') {
        const val = extractFastbootVar(text, 'product');
        return `设备代号：${val || '未识别'}${val ? '' : `（原始返回：${text}）`}`;
    }
    if (a0 === 'getvar' && a1 === 'current-slot') {
        const m = String(text).match(/(?:current-slot\s*:\s*)?([ab])/i);
        if (m) {
            currentSlot = m[1].toLowerCase();
            isAbDevice = true;
            document.getElementById('slotBadge').style.display = 'inline-block';
            document.getElementById('slotBadge').textContent = `当前槽位：${currentSlot.toUpperCase()}`;
            updateToolCurrentSlotBadge();
            updateSmartUI();
            updatePrecheckSummary();
            updateDeviceInfoSummary();
        }
        return `当前槽位：${m ? m[1].toUpperCase() : text}`;
    }
    if (a0 === 'flashing' && a1 === 'get_unlock_ability') {
        const m = String(text).match(/(\d+)/);
        return m && m[1] === '1' ? `允许解锁：是（原始返回：${text}）` : `允许解锁：否/未知（原始返回：${text}）`;
    }
    return text;
}

// ============ 模块初始化 ============
Modules.register('custom-flash', ['api','utils','device-info'], function initCustomFlashModule() {
    customImgSourceEl = document.getElementById('customImgSource');
    customRomSelectEl = document.getElementById('customRomSelect');
    customImgSelectEl = document.getElementById('customImgSelect');

    if (customImgSourceEl) customImgSourceEl.onchange = handleCustomImgSourceChange;
    if (customRomSelectEl) customRomSelectEl.onchange = handleCustomRomChange;
    const addCustomBtn = document.getElementById('addCustomBtn');
    if (addCustomBtn) addCustomBtn.onclick = handleAddCustom;

    console.log('[custom-flash] 单刷模块已初始化');
    return true;
});
