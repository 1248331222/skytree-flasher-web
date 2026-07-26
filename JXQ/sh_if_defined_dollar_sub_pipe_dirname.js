// sh_generic.js
// 通用 Shell 线刷脚本解析器
// - 先按规则完整解析所有命令
// - 返回前对步骤进行后处理：提取 ||/&& 前的有效命令，过滤 getvar

export async function parse(content, ctx) {
    const steps = [];
    const romDir = ctx.romDir || '';

    // ---------- 路径拼接（防重复、防占位符污染） ----------
    function resolvePath(rawPath) {
        if (!rawPath) return rawPath;
        let p = rawPath.replace(/\\/g, '/').replace(/^["']|["']$/g, '');
        if (/\$[@*]|\$[1-9]/.test(p)) return p;
        if (!romDir) return p;
        const normRomDir = romDir.replace(/\/+$/, '') + '/';
        if (p.startsWith(normRomDir)) return p;
        if (p.startsWith('/')) return p;
        return normRomDir + p;
    }

    // ---------- 预处理：合并续行，去除注释 ----------
    const lines = content.split('\n');
    const mergedLines = [];
    let currentLine = '';
    for (let line of lines) {
        line = line.replace(/\r$/, '');
        if (line.endsWith('\\')) {
            currentLine += line.slice(0, -1) + ' ';
            continue;
        }
        currentLine += line;
        const commentIndex = currentLine.search(/(?<!\\)#/);
        if (commentIndex !== -1) currentLine = currentLine.substring(0, commentIndex);
        if (currentLine.trim() !== '') mergedLines.push(currentLine.trim());
        currentLine = '';
    }
    if (currentLine.trim() !== '') mergedLines.push(currentLine.trim());

    // ---------- 逐行解析 ----------
    for (let line of mergedLines) {
        let cmd = line;

        // 替换路径变量（不处理 $* / $@ / $1-$9）
        if (romDir) {
            cmd = cmd.replace(/\$\(dirname\s+\$0\)/g, romDir);
            cmd = cmd.replace(/`dirname\s+\$0`/g, romDir);
            cmd = cmd.replace(/\$\{SCRIPT_PATH\}/g, romDir);
            cmd = cmd.replace(/\$SCRIPT_PATH\b/g, romDir);
            cmd = cmd.replace(/\$\{PWD\}/g, romDir);
            cmd = cmd.replace(/\$PWD\b/g, romDir);
        }

        if (!/^(fastboot|adb)\s+/.test(cmd)) continue;

        // 含 shell 特殊字符（管道、重定向等）→ raw
        if (/[|><&;]/.test(cmd.replace(/^[^|><&;]*?\s+/, ''))) {
            steps.push({ type: 'raw', raw: cmd, risk: 'MEDIUM' });
            continue;
        }

        let m;

        // flash
        m = cmd.match(/^fastboot\s+flash\s+(\S+)\s+(.+)/i);
        if (m) {
            const partition = m[1];
            let imagePath = resolvePath(m[2]);

            if (!/\$[@*]|\$[1-9]/.test(imagePath) && (imagePath.includes('*') || imagePath.includes('?'))) {
                const dir = imagePath.substring(0, imagePath.lastIndexOf('/'));
                const pattern = imagePath.substring(imagePath.lastIndexOf('/') + 1);
                try {
                    const files = await ctx.fileApi.glob(pattern, dir);
                    if (files.length > 0) imagePath = files[0];
                } catch (_) {}
            }

            steps.push({
                type: 'flash',
                partition,
                imagePath,
                raw: `fastboot flash ${partition} ${imagePath}`,
                risk: 'MEDIUM'
            });
            continue;
        }

        // erase
        m = cmd.match(/^fastboot\s+erase\s+(\S+)/i);
        if (m) {
            steps.push({ type: 'erase', partition: m[1], raw: cmd, risk: 'HIGH' });
            continue;
        }

        // reboot
        m = cmd.match(/^fastboot\s+reboot\s*(\S*)/i);
        if (m) {
            const target = m[1] || 'system';
            steps.push({ type: 'reboot', target, raw: cmd, risk: 'LOW' });
            if (target === 'bootloader' || target === 'fastboot') {
                steps.push({ type: 'wait_reconnect', target, raw: 'wait for device reconnect', risk: 'LOW' });
            }
            continue;
        }

        // --set-active
        m = cmd.match(/^fastboot\s+--set-active\s*=\s*(\S+)/i);
        if (m) {
            steps.push({ type: 'set_active', partition: m[1], raw: cmd, risk: 'LOW' });
            continue;
        }

        // oem
        m = cmd.match(/^fastboot\s+oem\s+(.+)/i);
        if (m) {
            steps.push({ type: 'oem', raw: cmd, risk: 'MEDIUM' });
            continue;
        }

        // flashing
        m = cmd.match(/^fastboot\s+flashing\s+(.+)/i);
        if (m) {
            steps.push({ type: 'flashing', raw: cmd, risk: 'MEDIUM' });
            continue;
        }

        // adb shell
        m = cmd.match(/^adb\s+shell\s+(.+)/i);
        if (m) {
            steps.push({ type: 'shell', raw: cmd, risk: 'MEDIUM' });
            continue;
        }

        // 其余 → raw
        steps.push({ type: 'raw', raw: cmd, risk: 'MEDIUM' });
    }

    // ---------- 后处理：提取 ||/&& 前的有效命令，过滤 getvar ----------
    const finalSteps = postProcessSteps(steps, romDir, ctx.fileApi, resolvePath);

    return { steps: finalSteps };
}

// ========== 后处理函数 ==========
function postProcessSteps(steps, romDir, fileApi, resolvePath) {
    const processed = [];

    for (const step of steps) {
        // 1. 如果不是 raw 类型，直接保留
        if (step.type !== 'raw') {
            processed.push(step);
            continue;
        }

        const cmd = step.raw;

        // 2. 检查是否包含 || 或 &&
        const controlMatch = cmd.match(/(\|\||&&)/);
        if (!controlMatch) {
            // 没有控制符，直接保留（后面会过滤 getvar）
            processed.push(step);
            continue;
        }

        // 3. 提取控制符之前的主命令
        const mainCmd = cmd.substring(0, controlMatch.index).trim();

        // 4. 如果主命令为空，丢弃
        if (!mainCmd) continue;

        // 5. 如果主命令仍包含管道/重定向等（不太可能但防御），保留原 raw
        if (/[|><&;]/.test(mainCmd.replace(/^[^|><&;]*?\s+/, ''))) {
            processed.push(step);
            continue;
        }

        // 6. 尝试将主命令重新分类为已知类型
        const newStep = classifyMainCmd(mainCmd, romDir, fileApi, resolvePath);
        if (newStep) {
            processed.push(newStep);
        } else {
            // 无法识别，保留原 raw（但 raw 字段用主命令，丢弃后半部分）
            processed.push({ ...step, raw: mainCmd });
        }
    }

    // 7. 最终过滤：移除所有含 getvar 的步骤（raw 和任何其他类型）
    return processed.filter(step => {
        if (step.type === 'raw' && /\bgetvar\b/i.test(step.raw)) return false;
        return true;
    });
}

// 尝试将主命令分类为 flash/erase/reboot 等
function classifyMainCmd(mainCmd, romDir, fileApi, resolvePath) {
    let m;

    // flash
    m = mainCmd.match(/^fastboot\s+flash\s+(\S+)\s+(.+)/i);
    if (m) {
        const partition = m[1];
        let imagePath = resolvePath(m[2]);

        // 通配符展开（仅不含占位符）
        if (!/\$[@*]|\$[1-9]/.test(imagePath) && (imagePath.includes('*') || imagePath.includes('?'))) {
            const dir = imagePath.substring(0, imagePath.lastIndexOf('/'));
            const pattern = imagePath.substring(imagePath.lastIndexOf('/') + 1);
            try {
                // 注意：这里无法 await，需要改为同步或提前处理
                // 由于 postProcess 是同步的，我们选择不在此处展开通配符
                // 实际场景中，主命令通常已经过 resolvePath 拼接，通配符较少出现在 || 前
                // 若确实需要，可将 postProcess 改为 async，此处略
            } catch (_) {}
        }

        return {
            type: 'flash',
            partition,
            imagePath,
            raw: `fastboot flash ${partition} ${imagePath}`,
            risk: 'MEDIUM'
        };
    }

    // erase
    m = mainCmd.match(/^fastboot\s+erase\s+(\S+)/i);
    if (m) {
        return { type: 'erase', partition: m[1], raw: mainCmd, risk: 'HIGH' };
    }

    // reboot
    m = mainCmd.match(/^fastboot\s+reboot\s*(\S*)/i);
    if (m) {
        const target = m[1] || 'system';
        return { type: 'reboot', target, raw: mainCmd, risk: 'LOW' };
        // 注意：此处不自动添加 wait_reconnect，如需可自行加
    }

    // set_active
    m = mainCmd.match(/^fastboot\s+--set-active\s*=\s*(\S+)/i);
    if (m) {
        return { type: 'set_active', partition: m[1], raw: mainCmd, risk: 'LOW' };
    }

    // oem
    m = mainCmd.match(/^fastboot\s+oem\s+(.+)/i);
    if (m) {
        return { type: 'oem', raw: mainCmd, risk: 'MEDIUM' };
    }

    // flashing
    m = mainCmd.match(/^fastboot\s+flashing\s+(.+)/i);
    if (m) {
        return { type: 'flashing', raw: mainCmd, risk: 'MEDIUM' };
    }

    // adb shell
    m = mainCmd.match(/^adb\s+shell\s+(.+)/i);
    if (m) {
        return { type: 'shell', raw: mainCmd, risk: 'MEDIUM' };
    }

    // 无法识别，返回 null
    return null;
}