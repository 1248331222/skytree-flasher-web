// flash_tool/static/js/api.js
// ============ WebUSB 模式 API 层 ============
// 项目已分离为纯 WebUSB 模式，移除 WebSocket、后端 API 请求封装。

/**
 * 更新环境状态显示（WebUSB 模式下隐藏后端连接状态）。
 */
function updateEnvStatusConnection() {
    envStatusEl.className = envStatusBaseClass;
    envStatusEl.textContent = '';
    envStatusEl.style.display = 'none';
}

/**
 * 统一管理功能模块的 UI 状态、进度和执行流程的封装类。
 * 典型用法：
 *   const rebootTask = new ModuleTask('toolbox', '重启设备');
 *   rebootTask.confirm('确认重启设备到 fastboot 模式？', async () => {
 *       await rebootTask.execFastboot(['reboot', 'bootloader']);
 *   });
 */
class ModuleTask {
    /**
     * 创建模块任务实例。
     * @param {string} module - 模块名（对应 setModuleStatus 的第一个参数）。
     * @param {string} label - 功能标签（用于日志和状态显示）。
     */
    constructor(module, label) {
        this.module = module;      // 模块名（对应 setModuleStatus 的第一个参数）
        this.label = label;       // 功能标签（用于日志和状态显示）
    }

    /**
     * 设置当前模块的状态文本和样式。
     * @param {string} msg - 状态文本。
     * @param {string} [type=''] - 状态类型（ok/warn/err/info 等）。
     */
    status(msg, type = '') {
        setModuleStatus(this.module, `${this.label}状态：${msg}`, type);
    }

    /**
     * 显示当前模块的进度条。
     * @param {string} [label] - 进度条标签，默认使用任务标签。
     */
    showProgress(label) {
        showModuleProgress(this.module, label || this.label);
    }

    /**
     * 更新当前模块的进度百分比。
     * @param {number} percent - 进度百分比（0-100）。
     * @param {string} [label] - 进度条标签。
     */
    updateProgress(percent, label) {
        updateModuleProgress(this.module, percent, label);
    }

    /**
     * 隐藏当前模块的进度条。
     */
    hideProgress() {
        hideModuleProgress(this.module);
    }

    /**
     * 向全局日志输出带标签的消息。
     * @param {string} msg - 日志内容。
     * @param {string} [type='normal'] - 日志类型（ok/err/warn/tip/info 等）。
     */
    log(msg, type = 'normal') {
        writeLog(`[${this.label}] ${msg}`, type);
    }

    /**
     * 弹出确认弹窗，用户确认后执行任务函数，并统一捕获异常。
     * @param {string} title - 弹窗标题。
     * @param {string} content - 弹窗内容。
     * @param {function} fn - 用户确认后执行的异步函数。
     */
    async confirm(title, content, fn) {
        showConfirm(title, content, async () => {
            try {
                await fn();
            } catch(e) {
                this.hideProgress();
                this.status(`失败：${e.message}`, 'err');
                this.log(e.message, 'err');
            }
        });
    }

    /**
     * 通过 WebUSB 执行 fastboot 命令。
     * @param {string[]} args - fastboot 子命令参数数组。
     * @param {Object} [options={}] - 执行选项（保留扩展用）。
     * @returns {Promise<*>} 命令执行结果。
     * @throws {Error} 命令执行失败时抛出异常。
     */
    async execFastboot(args, options = {}) {
        if (!webusbFastbootReady) {
            throw new Error('WebUSB Fastboot 未连接');
        }
        return await webusbFastboot.fastbootCommand(args.join(' '));
    }

    /**
     * 执行分区擦除操作，失败时针对 AB 设备自动尝试 _a/_b 双槽位回退。
     * @param {string} part - 要擦除的分区名。
     * @param {Object} [options={}] - 执行选项（保留扩展用）。
     * @returns {Promise<boolean>} 擦除成功返回 true。
     * @throws {Error} 所有擦除尝试均失败时抛出异常。
     */
    async erasePartition(part, options = {}) {
        this.log(`擦除分区：${part}`);
        try {
            await this.execFastboot(['erase', part]);
            this.log(`擦除 ${part} 完成`, 'ok');
            return true;
        } catch(e) {
            // 如果是 AB 设备且分区名不含 _a/_b 后缀，尝试添加
            if (isAbDevice && !part.endsWith('_a') && !part.endsWith('_b')) {
                this.log(`尝试擦除 ${part}_a ...`);
                try {
                    await this.execFastboot(['erase', part + '_a']);
                    await this.execFastboot(['erase', part + '_b']);
                    this.log(`擦除 ${part}_a + ${part}_b 完成`, 'ok');
                    return true;
                } catch(e2) {
                    throw e2;
                }
            }
            throw e;
        }
    }
}

// 注册 API 模块
Modules.register('api', [], async function initApiModule() {
    console.log('[api] WebUSB API 层已就绪');
    return true;
});
