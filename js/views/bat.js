// flash_tool/static/js/bat.js
// ============ BAT 脚本 ============
async function refreshBatList() {
    const rn = getSelectedRomProject();
    if (!rn) { writeLog('请先选择已解压线刷项目', 'err'); return; }

    document.getElementById('batSelect').innerHTML = '<option value="">加载中...</option>';
    // WebUSB 模式：不依赖后端 ROM 列表，提示用户使用文件选择器
    writeLog('WebUSB 模式：请使用新线刷页面的「选择脚本」按钮通过文件选择器选择刷机脚本', 'tip');
    document.getElementById('batSelect').innerHTML = '<option value="">WebUSB 模式请使用文件选择器选择脚本</option>';
    document.getElementById('importBatBtn').disabled = true;
}

// v3.0.2: 将步骤列表转换为 .sh 脚本格式，用于统一模拟执行
function stepsToShScript(steps) {
    const lines = ['#!/bin/bash', 'FASTBOOT=${FASTBOOT:-fastboot}'];
    steps.forEach(step => {
        const type = step.type || 'flash';
        const part = step.partition || step.part || '';
        const fileName = step.fileName || step.image || '';
        const params = step.params || '';
        const target = step.target || '';

        if (type === 'flash') {
            const imgPath = step.imagePath || step.fileName || '';
            lines.push(`$FASTBOOT flash ${part} ${imgPath} ${params}`.trim());
        } else if (type === 'erase') {
            lines.push(`$FASTBOOT erase ${part}`);
        } else if (type === 'format') {
            lines.push(`$FASTBOOT format ${part}`);
        } else if (type === 'reboot') {
            lines.push(`$FASTBOOT reboot ${target || part || ''}`.trim());
        } else if (type === 'boot') {
            lines.push(`$FASTBOOT boot ${fileName}`);
        } else if (type === 'oem') {
            lines.push(`$FASTBOOT oem ${target || part || ''}`.trim());
        } else if (type === 'flashing') {
            lines.push(`$FASTBOOT flashing ${target || part || ''}`.trim());
        } else if (type === 'set_active') {
            lines.push(`$FASTBOOT set_active ${target || part || 'a'}`.trim());
        } else if (type === 'delete-logical-partition') {
            lines.push(`$FASTBOOT delete-logical-partition ${part}`);
        } else if (type === 'resize-partition') {
            lines.push(`$FASTBOOT resize-partition ${part} ${step.size || ''}`.trim());
        } else if (type === 'getvar') {
            lines.push(`$FASTBOOT getvar ${part}`);
        } else if (type === 'wipe') {
            lines.push(`$FASTBOOT -w`);
        } else if (type === 'devices') {
            lines.push(`$FASTBOOT devices`);
        } else if (step.raw) {
            lines.push(step.raw);
        }
    });
    return lines.join('\n');
}

async function simulateFlash() {
    if (stepList.length === 0) {
        writeLog('没有可模拟的步骤', 'err');
        return;
    }
    // WebUSB 模式：本地模拟（dry_run），不依赖后端
    writeLog('开始模拟刷入（本地 dry_run 模式）...', 'warn');
    setModuleStatus('batch', '模拟刷入中...', 'info');
    showModuleProgress('batch', '模拟执行');
    document.getElementById('simulateBtn').disabled = true;
    try {
        for (let i = 0; i < stepList.length; i++) {
            const step = stepList[i];
            const desc = step.raw || `${step.type || 'flash'} ${step.part || step.partition || ''} ${step.fileName || step.image || ''}`;
            writeLog(`[模拟 ${i + 1}/${stepList.length}] ${desc}`, 'tip');
            updateModuleProgress('batch', Math.round((i + 1) / stepList.length * 100), `模拟 ${i + 1}/${stepList.length}`);
            await new Promise(r => setTimeout(r, 50));
        }
        writeLog('模拟刷入完成（dry_run），未实际执行任何命令', 'ok');
        setModuleStatus('batch', '模拟刷入完成', 'ok');
    } catch(e) {
        writeLog('模拟刷入出错：' + e.message, 'err');
    } finally {
        hideModuleProgress('batch');
        document.getElementById('simulateBtn').disabled = false;
    }
}

function fallbackToMergedSteps(d, rn, bp) {
    // 降级：使用 import_bat 返回的合并步骤
    if (d.steps && d.steps.length > 0) {
        stepList = d.steps;
        document.getElementById('stepList').style.display = '';
        document.getElementById('toggleStepsBtn').style.display = '';
        document.getElementById('simulateBtn').style.display = '';
        renderSteps();
        expandStepList();
        writeLog('已降级使用合并步骤，共 ' + stepList.length + ' 步', 'warn');
        document.getElementById('simulateBtn').disabled = false;
    } else {
        writeLog('合并步骤为空', 'err');
    }
}

function renderSteps() {
    stepListEl.innerHTML = '';

    if (stepList.length === 0) {
        stepListEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">解析脚本生成步骤</div>';
        updateBatchSummary();
        updateBtnState();
        return;
    }

    // 使用 DocumentFragment 减少 DOM 重排
    const frag = document.createDocumentFragment();
    stepList.forEach((item, idx) => {
        const d = document.createElement('div');
        d.className = 'step-item';
        
        let lab, cls, cont, badge = '';
        switch(item.type) {
            case 'flash':
                lab = '刷写'; cls = 'type-flash';
                const displayPath = item.imagePath || item.fileName || '';
                const isWildcard = (item.part || '').includes('%%') || (displayPath || '').includes('%%');
                if (isWildcard) {
                    lab = '刷写(循环)'; 
                    const partBase = (item.part || '').replace(/%%~nf_([ab])/, '分区_$1');
                    cont = `${escHtml(partBase)} ← ${escHtml(displayPath)}`;
                    badge = '<span class="step-badge badge-loop">循环展开</span>';
                } else {
                    cont = `${escHtml(item.part)} → ${escHtml(displayPath)} ${escHtml(item.params||'')}`;
                }
                if (item.prefixParams && (item.prefixParams.includes('disable-verity') || item.prefixParams.includes('disable-verification'))) {
                    badge = '<span class="step-badge badge-avb">禁用AVB</span>';
                }
                break;
            case 'erase':
                lab = '擦除'; cls = 'type-erase'; cont = escHtml(item.part);
                if (item.cow_cleanup) {
                    badge = '<span class="step-badge badge-cow">COW动态清理</span>';
                }
                break;
            case 'set_active': lab = '设槽位'; cls = 'type-set'; cont = `激活 ${escHtml(item.part)}`; break;
            case 'reboot': lab = '重启'; cls = 'type-reboot'; cont = '重启到 ' + ((item.part && escHtml(item.part)) || '系统'); break;
            case 'devices': lab = '检测'; cls = 'type-devices'; cont = '等待设备连接'; break;
            case 'oem': lab = 'OEM'; cls = 'type-oem'; cont = escHtml(item.part) || '命令'; break;
            case 'flashing': lab = '解锁'; cls = 'type-flashing'; cont = escHtml(item.part) || ''; break;
            case 'update': lab = '更新'; cls = 'type-update'; cont = 'fastboot update'; break;
            case 'boot': lab = '启动'; cls = 'type-boot'; cont = escHtml(item.fileName) || ''; break;
            case 'format': lab = '格式化'; cls = 'type-format'; cont = escHtml(item.part) || ''; break;
            case 'getvar': lab = '查询'; cls = 'type-getvar'; cont = escHtml(item.part || item.raw || '') || escHtml(item.type || ''); break;
            case 'wipe': lab = '清空'; cls = 'type-erase'; cont = `清空 userdata（fastboot -w）`; break;
            case 'adb': lab = 'ADB'; cls = 'type-adb'; cont = escHtml(item.raw) || ''; break;
            case 'delete-logical-partition': lab = '删分区'; cls = 'type-erase'; cont = escHtml(item.part) || ''; badge = '<span class="step-badge badge-cow">COW</span>'; break;
            default:
                lab = '其他'; cls = 'type-other';
                cont = escHtml(item.type || '') + ' ' + escHtml(item.part || '') + ' ' + escHtml(item.raw || '').substring(0, 60);
                break;
        }
        
        if (item.condition) {
            badge += '<span class="step-badge badge-cond">条件执行</span>';
        }
        if (item.loop) {
            badge += '<span class="step-badge badge-loop">循环展开</span>';
        }
        
        d.innerHTML = `<span class="idx">${idx+1}</span><span class="type ${cls}">${lab}</span><span>${cont}</span>${badge}<button class="del-btn" data-idx="${idx}">删除</button>`;
        frag.appendChild(d);
    });
    stepListEl.appendChild(frag);
    
    stepListEl.querySelectorAll('.del-btn').forEach(b => {
        b.onclick = e => {
            stepList.splice(+e.target.dataset.idx, 1);
            renderSteps();
        };
    });
    
    updateBatchSummary();
    updateRiskSummary();
    updateResumeCard();
    updateBtnState();
}

function expandStepList() {
    if (stepList.length === 0) return;
    stepListEl.classList.remove('collapsed');
    document.getElementById('toggleStepsBtn').textContent = '收起步骤 ▴';
    localStorage.setItem('steps_expanded', '1');
}

function clearBatchSteps() {
    stepList = [];
    localStorage.removeItem('batch_progress');
    clearReconnectCheckpoint();
    document.getElementById('exportBatchLogBtn').style.display = 'none';

    batchTip.textContent = '';
    hideModuleProgress('batch');
    setModuleStatus('batch', '线刷状态：WebUSB模式等待解析刷机脚本。', 'info');
    renderSteps();
    writeLog('已清空线刷步骤', 'info');
    updateResumeCard();

    // 隐藏复杂脚本模式的所有新增元素
    ['scriptProcessArea', 'complexScriptBanner', 'batSourceDetails', 'shNativePreviewArea', 'customScriptArea', 'riskSummaryCard'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    // 恢复简单脚本模式 UI
    document.getElementById('stepList').style.display = '';
    document.getElementById('toggleStepsBtn').style.display = '';
    document.getElementById('simulateBtn').style.display = '';
    window._isComplexScript = false;
    window._isNativeSh = false;
    window._scriptType = '';
    window._shContent = '';
    window._customScriptPath = '';
    window._batSourceContent = '';
    window._hydraSummary = null;
}

function resumeFlash() {
    const saved = localStorage.getItem('batch_progress');
    if (!saved) return;
    const data = JSON.parse(saved);
    if (data.rom_name) document.getElementById('romProjectSelect').value = data.rom_name;
    stepList = data.steps || [];
    pendingResumeIndex = Number(data.step_index || 0);
    renderSteps();
    writeLog(`已加载断点，将从第 ${pendingResumeIndex + 1} 步继续`, 'tip');
    startFlashFromIndex(pendingResumeIndex);
}

function restartFlash() {
    localStorage.removeItem('batch_progress');
    clearReconnectCheckpoint();
    document.getElementById('exportBatchLogBtn').style.display = 'none';
    pendingResumeIndex = 0;
    updateResumeCard();
    startFlashFromIndex(0);
}

// 导出日志按钮
async function exportBatchLog() {
    try {
        // WebUSB 模式：导出本地页面日志
        let logContent = '';
        const logBoxes = (typeof pageLogBoxes !== 'undefined') ? pageLogBoxes : {};
        for (const view in logBoxes) {
            const box = logBoxes[view];
            if (box && box.el) {
                logContent += `===== ${view} =====\n${box.el.textContent}\n\n`;
            }
        }
        if (!logContent) logContent = '暂无日志记录';
        const blob = new Blob([logContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'flash_log_' + new Date().toISOString().slice(0, 10) + '.txt';
        a.click();
        URL.revokeObjectURL(url);
        writeLog('日志已导出', 'ok');
    } catch (e) {
        writeLog('导出日志失败: ' + e, 'err');
    }
}

function clearResume() {
    localStorage.removeItem('batch_progress');
    clearReconnectCheckpoint();
    pendingResumeIndex = 0;
    updateResumeCard();
    writeLog('已清除断点记录', 'info');
}

// ============ 模块初始化 ============
Modules.register('bat', ['api','utils','rom'], function initBatModule() {
    document.getElementById('refreshBatBtn').onclick = refreshBatList;

    document.getElementById('romProjectSelect').onchange = () => {
        stepList = [];
        renderSteps();
        document.getElementById('batSelect').innerHTML = '<option value="">选择刷机脚本</option>';
        document.getElementById('importBatBtn').disabled = true;
        document.getElementById('simulateBtn').disabled = true;
        if (document.getElementById('romProjectSelect').value) refreshBatList();
    };

    document.getElementById('batSelect').onchange = () => {
        document.getElementById('importBatBtn').disabled = !document.getElementById('batSelect').value;
        // v3.9.0: 参数输入框始终可见（从占用行内改为独占一行）
        // 不再根据文件后缀隐藏/显示
    };

    document.getElementById('importBatBtn').onclick = async () => {
        // WebUSB 模式：脚本解析请使用新线刷页面的「选择脚本」按钮
        writeLog('WebUSB 模式：请使用新线刷页面的「选择脚本」按钮通过文件选择器选择并解析刷机脚本', 'tip');
        document.getElementById('importBatBtn').disabled = false;
    };

    document.getElementById('simulateBtn').onclick = simulateFlash;

    document.getElementById('toggleStepsBtn').onclick = () => {
        stepListEl.classList.toggle('collapsed');
        document.getElementById('toggleStepsBtn').textContent = stepListEl.classList.contains('collapsed') ? '查看步骤 ▾' : '收起步骤 ▴';
        localStorage.setItem('steps_expanded', stepListEl.classList.contains('collapsed') ? '0' : '1');
    };

    document.getElementById('clearBatchStepsBtn').onclick = clearBatchSteps;
    document.getElementById('resumeFlashBtn').onclick = resumeFlash;
    document.getElementById('restartFlashBtn').onclick = restartFlash;
    document.getElementById('exportBatchLogBtn').onclick = exportBatchLog;
    document.getElementById('clearResumeBtn').onclick = clearResume;

    console.log('[bat] BAT 模块已初始化');
    return true;
});