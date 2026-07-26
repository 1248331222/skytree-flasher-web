// 文件名：按分类器特征键命名，如 bat_rule_based.js
/**
 * 通用 BAT 刷机脚本解析器
 * 适配特征键：bat_rule_based
 * 支持变量、循环(for)、条件(if)、子命令等
 */
export async function parse(content, ctx) {
    const steps = [];
    const vars = {};
    const romDir = ctx.romDir || '';
    const fileApi = ctx.fileApi;
    let delayedExpansion = false;

    // ========== 工具函数 ==========

    /** 解析 %VAR% 和 !VAR!，保留 %* %1-%9 */
    function resolveVars(text) {
        text = text.replace(/%~dp0/gi, romDir + '/');
        text = text.replace(/%(\w+)%/g, (match, name) => {
            if (name === '*' || /^[1-9]$/.test(name)) return match;
            return vars[name] !== undefined ? vars[name] : match;
        });
        if (delayedExpansion) {
            text = text.replace(/!(\w+)!/g, (match, name) => {
                return vars[name] !== undefined ? vars[name] : match;
            });
        }
        return text;
    }

    /** 路径拼接：已包含 romDir 则直接使用，否则拼接（避免重复） */
    function resolvePath(rawPath) {
        if (!rawPath) return rawPath;
        // 去掉可能的引号与反斜杠
        let p = rawPath.replace(/\\/g, '/').replace(/^["']|["']$/g, '');
        if (!romDir) return p;                       // 无 romDir，保留原样
        // 已包含完整 romDir 前缀，不重复拼接
        if (p.startsWith(romDir.replace(/\/+$/, '') + '/')) return p;
        if (p.startsWith('/')) return p;             // 绝对路径不拼接
        // 相对路径，拼接 romDir
        return romDir.replace(/\/+$/, '') + '/' + p;
    }

    /** 展开 for 循环变量（支持 ~f / ~n / ~x / ~p 修饰符） */
    function expandAllForVars(str, forStack) {
        if (!forStack.length) return str;
        const varNames = forStack.map(c => c.var);
        const pattern = `%%(~[a-zA-Z]*)?(${varNames.join('|')})`;
        const re = new RegExp(pattern, 'g');
        return str.replace(re, (match, modifier, varName) => {
            const ctx = forStack.find(c => c.var === varName);
            if (!ctx) return match;
            const rawVal = ctx.value;
            const full = resolvePath(rawVal);  // 统一使用 resolvePath
            if (!modifier) return rawVal;
            const mod = modifier.toLowerCase();
            if (mod === '~') return rawVal.replace(/^["']|["']$/g, '');
            if (mod.includes('f')) return full;
            if (mod.includes('n')) {
                const name = full.split('/').pop();
                return name.replace(/\.[^/.]+$/, '');
            }
            if (mod.includes('x')) {
                const name = full.split('/').pop();
                const m = name.match(/\.[^/.]+$/);
                return m ? m[0] : '';
            }
            if (mod.includes('p')) return full.substring(0, full.lastIndexOf('/') + 1);
            return rawVal;
        });
    }

    /** 命令行分割（正确处理引号） */
    function splitCmd(line) {
        const parts = [];
        let cur = '', inQ = false;
        for (const ch of line) {
            if (ch === '"') { inQ = !inQ; continue; }
            if ((ch === ' ' || ch === '\t') && !inQ) {
                if (cur) parts.push(cur);
                cur = '';
            } else {
                cur += ch;
            }
        }
        if (cur) parts.push(cur);
        return parts;
    }

    /** 风险等级映射 */
    function getRisk(part) {
        const critical = ['xbl', 'xbl_config', 'abl', 'bootloader', 'preloader_raw'];
        const high = ['modem', 'frp', 'metadata'];
        if (critical.includes(part?.toLowerCase())) return 'CRITICAL';
        if (high.includes(part?.toLowerCase())) return 'HIGH';
        return 'MEDIUM';
    }

    /** 从分割后的命令片段生成步骤对象 */
    function makeStep(parts, prefixParams) {
        if (!parts?.length) return null;
        const bin = parts[0].replace(/\\/g, '/').split('/').pop().replace(/\.exe$/i, '').toLowerCase();
        if (bin !== 'fastboot' && bin !== 'adb') return null;

        const rest = parts.slice(1);
        // 提取全局参数（如 --disable-verity --disable-verification）
        const globalParams = [];
        while (rest.length && rest[0].startsWith('--')) {
            globalParams.push(rest.shift());
        }
        if (prefixParams) globalParams.unshift(...prefixParams.split(/\s+/).filter(Boolean));

        const action = rest[0]?.toLowerCase() || '';

        // fastboot -w
        if (action === '-w') {
            return { type: 'raw', raw: 'fastboot -w', risk: 'HIGH' };
        }
        // fastboot getvar
        if (action === 'getvar') {
            return { type: 'getvar', raw: `fastboot ${rest.join(' ')}`, risk: 'LOW' };
        }
        // fastboot flash <partition> <image> [params]
        if (action === 'flash') {
            const partition = rest[1] || '';
            const rawImage = rest[2] || '';
            if (!partition || !rawImage) return null;
            // ★ 使用 resolvePath 避免路径重复
            const imagePath = resolvePath(rawImage);
            const extraParams = rest.slice(3).join(' ');
            // ★ raw 中的路径也使用拼接后的绝对路径，确保一致
            const raw = `fastboot${globalParams.length ? ' ' + globalParams.join(' ') : ''} flash ${partition} ${imagePath}${extraParams ? ' ' + extraParams : ''}`;
            return {
                type: 'flash',
                partition,
                imagePath,
                raw,
                risk: getRisk(partition),
                prefixParams: globalParams.join(' ') || undefined,
                params: extraParams || undefined
            };
        }
        // fastboot erase <partition>
        if (action === 'erase') {
            const partition = rest[1] || '';
            return { type: 'erase', partition, raw: `fastboot erase ${partition}`, risk: 'HIGH' };
        }
        // fastboot reboot [target]
        if (action === 'reboot') {
            const target = rest.slice(1).join(' ') || 'system';
            return {
                type: 'reboot',
                target,
                raw: `fastboot reboot${target !== 'system' ? ' ' + target : ''}`,
                risk: 'LOW'
            };
        }
        // fastboot set_active / --set-active
        if (action === 'set_active' || action === '--set-active') {
            const slot = rest[1] || '';
            return { type: 'set_active', partition: slot, raw: `fastboot set_active ${slot}`, risk: 'MEDIUM' };
        }
        // 其他已知子命令
        if (['delete-logical-partition', 'devices', 'oem', 'flashing'].includes(action)) {
            return { type: 'raw', raw: `fastboot ${rest.join(' ')}`, risk: 'MEDIUM' };
        }
        // 未知命令回退为 raw
        return { type: 'raw', raw: `fastboot ${rest.join(' ')}`, risk: 'MEDIUM' };
    }

    // ========== 第一阶段：收集 set 变量 ==========
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (/^setlocal\s+enabledelayedexpansion/i.test(trimmed)) delayedExpansion = true;
        const setMatch = trimmed.match(/^set\s+"?(\w+)=(.+?)"?\s*$/i);
        if (setMatch) vars[setMatch[1]] = setMatch[2];
    }
    for (const k in vars) vars[k] = resolveVars(vars[k]);

    // ========== 第二阶段：状态机递归处理 ==========
    async function processLines(linesArray, localVars, forStack) {
        const savedVars = { ...vars };
        if (localVars) Object.assign(vars, localVars);
        const stack = forStack || [];
        let idx = 0;
        let pendingFor = null, pendingIf = null;

        /** 执行单行命令（已展开变量） */
        async function executeLine(line) {
            line = expandAllForVars(line, stack);
            line = resolveVars(line);
            if (/^(fastboot|adb)\s+.+\|/.test(line) || /findstr/i.test(line)) return;
            const setMatch = line.match(/^\s*set\s+"?(\w+)=(.+?)"?\s*$/i);
            if (setMatch) { vars[setMatch[1]] = resolveVars(setMatch[2]); return; }
            const cleanLine = line.replace(/>.*$/i, '').trim();
            if (!cleanLine) return;
            const parts = splitCmd(cleanLine).map(p => expandAllForVars(p, stack));
            if (!parts.length) return;
            const step = makeStep(parts);
            if (step) steps.push(step);
        }

        /** 执行 for 循环块 */
        async function executeForBlock(block) {
            const items = await expandCollection(block.collection);
            for (const item of items) {
                vars[block.varName] = item;
                stack.push({ var: block.varName, value: item });
                await processLines(block.body, null, stack);
                stack.pop();
            }
        }

        /** 执行 if 块 */
        async function executeIfBlock(block) {
            let expandedCond = expandAllForVars(block.condition, stack);
            expandedCond = resolveVars(expandedCond);
            if (evalCondition(expandedCond)) {
                await processLines(block.body, null, stack);
            }
        }

        /** 简单条件求值 */
        function evalCondition(cond) {
            cond = cond.trim();
            let negated = false;
            if (/^not\s+/i.test(cond)) { negated = true; cond = cond.replace(/^not\s+/i, '').trim(); }
            let result;
            if (/^exist\s+/i.test(cond)) {
                result = true;
            } else if (/^\/i\s+/i.test(cond)) {
                const m = cond.match(/^\/i\s+"?([^"'\s]+)"?\s*==\s*"?(.+?)"?$/i);
                result = m ? m[1].toLowerCase() === m[2].toLowerCase() : false;
            } else {
                const strMatch = cond.match(/^"?([^"'\s]+)"?\s*==\s*"?(.+?)"?$/i);
                if (strMatch) {
                    result = strMatch[1] === strMatch[2];
                } else {
                    const numMatch = cond.match(/^(\S+)\s+(equ|neq)\s+(\S+)$/i);
                    if (numMatch) {
                        const l = parseInt(numMatch[1]), r = parseInt(numMatch[3]);
                        if (isNaN(l) || isNaN(r))
                            result = numMatch[2].toLowerCase() === 'equ' ? numMatch[1] === numMatch[3] : numMatch[1] !== numMatch[3];
                        else
                            result = numMatch[2].toLowerCase() === 'equ' ? l === r : l !== r;
                    } else if (/^errorlevel\s+\d+$/i.test(cond)) {
                        result = false;
                    } else {
                        result = true;
                    }
                }
            }
            return negated ? !result : result;
        }

        /** 展开集合（支持通配符、空格/逗号分隔） */
        async function expandCollection(collection) {
            collection = collection.replace(/^["']|["']$/g, '');
            collection = resolveVars(collection);
            if (/\*|\?/.test(collection)) {
                if (fileApi?.glob) {
                    const normalized = collection.replace(/\\/g, '/');
                    const lastSlash = normalized.lastIndexOf('/');
                    const dir = lastSlash >= 0 ? normalized.substring(0, lastSlash) : '';
                    const pattern = lastSlash >= 0 ? normalized.substring(lastSlash + 1) : normalized;
                    try {
                        const files = await fileApi.glob(pattern, dir || romDir);
                        if (files?.length) return files.map(f => f.replace(/\\/g, '/'));
                    } catch (_) { /* 静默降级 */ }
                }
                return [];
            }
            return collection.split(/[\s,]+/).filter(Boolean);
        }

        // 主循环
        while (idx < linesArray.length) {
            let rawLine = linesArray[idx].trim();
            idx++;
            if (!rawLine || /^(::|rem\b|@echo|title|color|cls|echo|pause|timeout|chcp|endlocal|goto|exit\b)/i.test(rawLine)) continue;
            if (rawLine.startsWith('@')) rawLine = rawLine.substring(1).trim();

            // 块状 for 收集
            if (pendingFor) {
                if (rawLine === ')') {
                    if (pendingFor.depth > 0) {
                        pendingFor.body.push(rawLine);
                        pendingFor.depth--;
                    } else {
                        await executeForBlock(pendingFor);
                        pendingFor = null;
                    }
                } else {
                    pendingFor.body.push(rawLine);
                    if (/\(\s*$/.test(rawLine)) pendingFor.depth++;
                }
                continue;
            }

            // 块状 if 收集
            if (pendingIf) {
                if (rawLine === ')') {
                    if (pendingIf.depth > 0) {
                        pendingIf.body.push(rawLine);
                        pendingIf.depth--;
                    } else {
                        await executeIfBlock(pendingIf);
                        pendingIf = null;
                    }
                } else {
                    pendingIf.body.push(rawLine);
                    if (/\(\s*$/.test(rawLine)) pendingIf.depth++;
                }
                continue;
            }

            const expanded = expandAllForVars(rawLine, stack);
            const resolved = resolveVars(expanded);

            // for 多行块开始
            const forStart = resolved.match(/^for\s+%%(\w)\s+in\s+\((.+?)\)\s+do\s*\(\s*$/i);
            if (forStart) {
                pendingFor = { varName: forStart[1], collection: forStart[2], body: [], depth: 0 };
                continue;
            }

            // if 多行块开始（跳过纯 errorlevel 块）
            const ifStart = resolved.match(/^if\s+(.+?)\s*\(\s*$/i);
            if (ifStart) {
                if (/^errorlevel\s+\d+$/i.test(ifStart[1])) {
                    let depth = 1;
                    while (idx < linesArray.length && depth > 0) {
                        const skipLine = linesArray[idx].trim();
                        idx++;
                        if (skipLine === ')') depth--;
                        else if (/\(\s*$/.test(skipLine)) depth++;
                    }
                    continue;
                }
                pendingIf = { condition: ifStart[1], body: [], depth: 0 };
                continue;
            }

            // 单行 for ... do ...
            const singleFor = resolved.match(/^for\s+%%(\w)\s+in\s+\((.+?)\)\s+do\s+(.+)/i);
            if (singleFor) {
                const varName = singleFor[1], collection = singleFor[2], command = singleFor[3];
                const items = await expandCollection(collection);
                for (const item of items) {
                    vars[varName] = item;
                    stack.push({ var: varName, value: item });
                    const expandedCmd = expandAllForVars(command, stack);
                    const finalCmd = resolveVars(expandedCmd);
                    await executeLine(finalCmd);
                    stack.pop();
                }
                continue;
            }

            // 单行 if exist ...
            const singleIf = resolved.match(/^if\s+(not\s+)?exist\s+"?([^"\s]+)"?\s+(.+)/i);
            if (singleIf) {
                const notExist = !!singleIf[1];
                const action = singleIf[3].replace(/\)\s*$/, '');
                if (!notExist) await executeLine(action);
                continue;
            }

            // 单行 if 条件赋值
            const ifSet = resolved.match(/^if\s+(?:\/i\s+)?["']?!?(\w+)!?["']?\s*==\s*["']?([^"'\s]+)["']?\s+set\s+"?(\w+)=(.+?)"?\s*$/i);
            if (ifSet) {
                const leftVal = resolveVars(ifSet[1]);
                const rightVal = expandAllForVars(ifSet[2], stack);
                if (ifSet[1].toLowerCase() === rightVal.toLowerCase() || leftVal === rightVal) {
                    vars[ifSet[3]] = ifSet[4];
                }
                continue;
            }

            await executeLine(resolved);
        }

        if (localVars) Object.assign(vars, savedVars);
    }

    await processLines(lines, null, []);

    return { steps };
}