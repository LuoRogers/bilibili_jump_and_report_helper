// ==UserScript==
// @name         B站中配视频跳转与举报助手
// @namespace    http://tampermonkey.net/
// @version      3.6
// @description  自动检测B站中配视频，提供跳转和举报功能，新增UID黑名单检查（原创作品或黑名单UP主），新增主页黑名单UP主视频屏蔽功能
// @author       YourName
// @match        https://www.bilibili.com/video/BV*
// @match        https://www.bilibili.com/
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @connect      api.bilibili.com
// @connect      raw.githubusercontent.com
// ==/UserScript==

(function () {
    'use strict';

    // 默认配置
    const DEFAULT_CONFIG = {
        KEYWORDS: ['中配'],
        YOUTUBE_REGEX: /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[^\s]+/gi,
        DELAY_TIME: 1500,
        AUTO_JUMP: false,
        AUTO_REPORT: false,
        REPORT_DESCRIPTION: "转载投自制，原视频链接为：${YOUTUBE_URL}",
        REPORT_HISTORY: [], // 举报历史记录
        HOMEPAGE_BLOCK_MODE: 'blur' // 主页屏蔽模式：'off'=关闭, 'blur'=模糊化, 'remove'=移除
    };

    // 获取配置
    const config = {
        KEYWORDS: GM_getValue('KEYWORDS', DEFAULT_CONFIG.KEYWORDS),
        YOUTUBE_REGEX: new RegExp(GM_getValue('YOUTUBE_REGEX', DEFAULT_CONFIG.YOUTUBE_REGEX.source), 'gi'),
        DELAY_TIME: GM_getValue('DELAY_TIME', DEFAULT_CONFIG.DELAY_TIME),
        AUTO_JUMP: GM_getValue('AUTO_JUMP', DEFAULT_CONFIG.AUTO_JUMP),
        AUTO_REPORT: GM_getValue('AUTO_REPORT', DEFAULT_CONFIG.AUTO_REPORT),
        REPORT_DESCRIPTION: GM_getValue('REPORT_DESCRIPTION', DEFAULT_CONFIG.REPORT_DESCRIPTION),
        REPORT_HISTORY: GM_getValue('REPORT_HISTORY', DEFAULT_CONFIG.REPORT_HISTORY), // 举报历史记录
        HOMEPAGE_BLOCK_MODE: GM_getValue('HOMEPAGE_BLOCK_MODE', DEFAULT_CONFIG.HOMEPAGE_BLOCK_MODE), // 主页屏蔽模式
        UID_BLACKLIST: [], // 将从文件加载
        UID_WHITELIST: GM_getValue('UID_WHITELIST', []), // 用户本地白名单
        FULL_BLACKLIST: [] // 完整的黑名单对象数组
    };

    // GitHub raw URL 用于加载黑名单
    const BLACKLIST_GITHUB_URL = 'https://raw.githubusercontent.com/LuoRogers/bilibili_jump_and_report_helper/master/blacklist_uid.json';

    // BV转AID函数
    function bv2av(bvid) {
        const XOR_CODE = 23442827791579n;
        const MASK_CODE = 2251799813685247n;
        const BASE = 58n;
        const data = 'FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUSDQX9RdoZf';

        const bvidArr = Array.from(bvid);
        [bvidArr[3], bvidArr[9]] = [bvidArr[9], bvidArr[3]];
        [bvidArr[4], bvidArr[7]] = [bvidArr[7], bvidArr[4]];
        bvidArr.splice(0, 3);
        const tmp = bvidArr.reduce((pre, bvidChar) => pre * BASE + BigInt(data.indexOf(bvidChar)), 0n);
        return Number((tmp & MASK_CODE) ^ XOR_CODE);
    }

    // 获取当前视频的BV号
    function getCurrentBV() {
        const url = window.location.href;
        const bvMatch = url.match(/\/video\/(BV\w+)/);
        return bvMatch ? bvMatch[1] : null;
    }

    // 举报视频
    function reportVideo(youtubeUrl) {
        const bv = getCurrentBV();
        if (!bv) {
            console.error('无法获取当前视频BV号');
            return;
        }

        // 检查是否已经举报过此视频
        if (config.REPORT_HISTORY.includes(bv)) {
            console.log(`视频 ${bv} 已经在举报历史中，跳过重复举报`);
            GM_notification({
                title: "跳过重复举报",
                text: `视频 ${bv} 已经在举报历史中`,
                timeout: 3000
            });
            return;
        }

        const aid = bv2av(bv);
        const csrf = getCsrfToken();

        if (!csrf) {
            console.error('无法获取CSRF token');
            return;
        }

        const reportData = {
            "reporter_info": {
                "reporter_type": 2,
                "verify_type": 0
            },
            "infringement_info": {
                "content": [{
                    "reported": {
                        "oid": aid,
                        "otype": 1,
                        "raw_url": ""
                    },
                    "origin": {
                        "oid": 0,
                        "otype": 100,
                        "raw_url": youtubeUrl
                    }
                }],
                "description": config.REPORT_DESCRIPTION.replace(/\$\{YOUTUBE_URL\}/g, youtubeUrl),
                "material": [],
                "report_account": false
            }
        };

        GM_xmlhttpRequest({
            method: "POST",
            url: `https://api.bilibili.com/x/v2/infringement/steal/submit?csrf=${csrf}`,
            headers: {
                "Content-Type": "application/json",
                "Referer": window.location.href,
                "Origin": "https://www.bilibili.com"
            },
            data: JSON.stringify(reportData),
            onload: function (response) {
                try {
                    const result = JSON.parse(response.responseText);
                    if (result.code === 0) {
                        // 将BV添加到举报历史中
                        if (!config.REPORT_HISTORY.includes(bv)) {
                            config.REPORT_HISTORY.push(bv);
                            GM_setValue('REPORT_HISTORY', config.REPORT_HISTORY);
                            console.log(`已将 ${bv} 添加到举报历史`);
                        }
                        
                        GM_notification({
                            title: "举报成功",
                            text: `已成功举报视频 BV${bv}`,
                            timeout: 3000
                        });
                    } else {
                        console.error('举报失败:', result.message);
                    }
                } catch (e) {
                    console.error('解析举报响应失败:', e);
                }
            },
            onerror: function (error) {
                console.error('举报请求失败:', error);
            }
        });
    }

    // 从Cookie中获取CSRF token
    function getCsrfToken() {
        const cookies = document.cookie.split(';');
        for (const cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'bili_jct') {
                return value;
            }
        }
        return null;
    }

    // 从GitHub加载UID黑名单
    function loadBlacklistFromGitHub(callback) {
        GM_xmlhttpRequest({
            method: "GET",
            url: BLACKLIST_GITHUB_URL,
            headers: {
                "Accept": "application/json"
            },
            onload: function (response) {
                try {
                    if (response.status === 200) {
                        const blacklist = JSON.parse(response.responseText);
                        if (Array.isArray(blacklist)) {
                            // 存储完整的黑名单对象数组
                            config.FULL_BLACKLIST = blacklist;
                            
                            // 从对象数组中提取UID字段并确保所有UID都是字符串格式
                            config.UID_BLACKLIST = blacklist.map(item => {
                                // 支持两种格式：直接是UID数字/字符串，或者包含uid字段的对象
                                if (typeof item === 'object' && item !== null && 'uid' in item) {
                                    return String(item.uid);
                                } else {
                                    // 向后兼容：如果是直接的数字/字符串
                                    return String(item);
                                }
                            });
                            console.log('成功加载UID黑名单:', config.UID_BLACKLIST);
                            console.log('完整黑名单数据:', config.FULL_BLACKLIST);
                            if (callback) callback(true);
                        } else {
                            console.error('黑名单格式错误，应为数组');
                            if (callback) callback(false);
                        }
                    } else {
                        console.error('加载黑名单失败，HTTP状态码:', response.status);
                        if (callback) callback(false);
                    }
                } catch (e) {
                    console.error('解析黑名单JSON失败:', e);
                    if (callback) callback(false);
                }
            },
            onerror: function (error) {
                console.error('加载黑名单请求失败:', error);
                if (callback) callback(false);
            }
        });
    }

    // 检查视频信息（版权、UP主UID和简介）
    function checkVideoInfo(aid, callback) {
        GM_xmlhttpRequest({
            method: "GET",
            url: `https://api.bilibili.com/x/web-interface/view?aid=${aid}`,
            headers: {
                "Referer": window.location.href,
                "Origin": "https://www.bilibili.com"
            },
            onload: function (response) {
                try {
                    const result = JSON.parse(response.responseText);
                    if (result.code === 0 && result.data) {
                        const ownerMidStr = String(result.data.owner?.mid);
                        const videoInfo = {
                            copyright: result.data.copyright, // 1=原创, 2=转载, 3=没填
                            ownerMid: result.data.owner?.mid,
                            description: result.data.desc || '', // 视频简介
                            isOriginal: result.data.copyright !== 2, // Tips: 我靠了啊，怎么copyright还有个3...
                            isBlacklisted: config.UID_BLACKLIST.includes(ownerMidStr),
                            isWhitelisted: config.UID_WHITELIST.includes(ownerMidStr)
                        };
                        callback(videoInfo);
                    } else {
                        console.error('获取视频信息失败:', result.message);
                        callback(null);
                    }
                } catch (e) {
                    console.error('解析视频信息响应失败:', e);
                    callback(null);
                }
            },
            onerror: function (error) {
                console.error('获取视频信息请求失败:', error);
                callback(null);
            }
        });
    }

    // 将UP主添加到白名单
    function addToWhitelist(uid) {
        const uidStr = String(uid);
        
        // 检查是否已经在白名单中
        if (config.UID_WHITELIST.includes(uidStr)) {
            alert(`UID ${uidStr} 已经在白名单中`);
            return false;
        }
        
        // 添加到白名单
        config.UID_WHITELIST.push(uidStr);
        GM_setValue('UID_WHITELIST', config.UID_WHITELIST);
        
        alert(`已成功将 UID ${uidStr} 添加到白名单`);
        console.log(`UID ${uidStr} 已添加到白名单，当前白名单:`, config.UID_WHITELIST);
        return true;
    }

    // 从白名单中删除UP主
    function removeFromWhitelist(uid) {
        const uidStr = String(uid);
        const index = config.UID_WHITELIST.indexOf(uidStr);
        
        if (index === -1) {
            alert(`UID ${uidStr} 不在白名单中`);
            return false;
        }
        
        config.UID_WHITELIST.splice(index, 1);
        GM_setValue('UID_WHITELIST', config.UID_WHITELIST);
        
        alert(`已成功从白名单中删除 UID ${uidStr}`);
        console.log(`UID ${uidStr} 已从白名单删除，当前白名单:`, config.UID_WHITELIST);
        return true;
    }

    // 清空白名单
    function clearWhitelist() {
        if (config.UID_WHITELIST.length === 0) {
            alert('白名单已经是空的');
            return false;
        }
        
        if (confirm(`确定要清空白名单吗？当前有 ${config.UID_WHITELIST.length} 个UID`)) {
            config.UID_WHITELIST = [];
            GM_setValue('UID_WHITELIST', []);
            alert('白名单已清空');
            console.log('白名单已清空');
            return true;
        }
        return false;
    }

    // 获取主页屏蔽模式文本
    function getHomepageBlockModeText(mode) {
        switch (mode) {
            case 'off':
                return '关闭';
            case 'blur':
                return '模糊化';
            case 'remove':
                return '移除';
            default:
                return '未知';
        }
    }

    // 注册菜单命令
    function registerMenuCommands() {
        // 切换自动跳转
        GM_registerMenuCommand(`自动跳转: ${config.AUTO_JUMP ? '开启' : '关闭'}`, function () {
            const newValue = !config.AUTO_JUMP;
            GM_setValue('AUTO_JUMP', newValue);
            config.AUTO_JUMP = newValue;
            alert(`自动跳转已${newValue ? '开启' : '关闭'}`);
            location.reload();
        });

        // 切换自动举报
        GM_registerMenuCommand(`自动举报: ${config.AUTO_REPORT ? '开启' : '关闭'}`, function () {
            const newValue = !config.AUTO_REPORT;
            GM_setValue('AUTO_REPORT', newValue);
            config.AUTO_REPORT = newValue;
            alert(`自动举报已${newValue ? '开启' : '关闭'}`);
            location.reload();
        });

        // 设置延迟时间
        GM_registerMenuCommand(`设置延迟时间 (当前: ${config.DELAY_TIME}ms)`, function () {
            const newDelay = prompt('请输入延迟时间（毫秒）:', config.DELAY_TIME);
            if (newDelay !== null && !isNaN(newDelay) && newDelay >= 0) {
                GM_setValue('DELAY_TIME', parseInt(newDelay));
                config.DELAY_TIME = parseInt(newDelay);
                alert(`延迟时间已设置为: ${newDelay}ms`);
                location.reload();
            }
        });

        // 设置关键词
        GM_registerMenuCommand(`设置关键词 (当前: ${config.KEYWORDS.join(', ')})`, function () {
            const newKeywords = prompt('请输入关键词（多个关键词用逗号分隔）:', config.KEYWORDS.join(', '));
            if (newKeywords !== null) {
                const keywordsArray = newKeywords.split(',').map(k => k.trim()).filter(k => k);
                if (keywordsArray.length > 0) {
                    GM_setValue('KEYWORDS', keywordsArray);
                    config.KEYWORDS = keywordsArray;
                    alert(`关键词已设置为: ${keywordsArray.join(', ')}`);
                    location.reload();
                }
            }
        });

        // 设置举报描述
        GM_registerMenuCommand(`设置举报描述 (当前: ${config.REPORT_DESCRIPTION})`, function () {
            const newDesc = prompt('请输入举报描述:', config.REPORT_DESCRIPTION);
            if (newDesc !== null && newDesc.trim() !== '') {
                GM_setValue('REPORT_DESCRIPTION', newDesc);
                config.REPORT_DESCRIPTION = newDesc;
                alert(`举报描述已设置为: ${newDesc}`);
            }
        });

        // 手动举报当前视频
        GM_registerMenuCommand('手动举报当前视频', function () {
            const bv = getCurrentBV();
            if (!bv) {
                alert('无法获取当前视频BV号');
                return;
            }

            const aid = bv2av(bv);

            // 使用API获取视频信息
            checkVideoInfo(aid, function (videoInfo) {
                if (!videoInfo) {
                    alert('无法获取视频信息');
                    return;
                }

                const youtubeMatch = videoInfo.description.match(config.YOUTUBE_REGEX);

                if (!youtubeMatch || !youtubeMatch[0]) {
                    alert('无法找到原视频链接，无法为您举报');
                    return;
                }

                const youtubeUrl = youtubeMatch[0];

                if (confirm(`确定要举报当前视频 (BV${bv}) 吗？`)) {
                    reportVideo(youtubeUrl);
                }
            });
        });

        // 黑名单/白名单管理（二级菜单）
        GM_registerMenuCommand('黑名单/白名单管理', function () {
            const menuOptions = [
                '1. 从GitHub加载UID黑名单',
                '2. 查看当前UID黑名单',
                '3. 查看当前UID白名单',
                '4. 添加当前UP主到白名单',
                '5. 从白名单中删除当前UP主',
                '6. 从白名单中删除指定UID',
                '7. 清空白名单',
                '8. 取消'
            ].join('\n');

            const choice = prompt(`请选择操作:\n\n${menuOptions}\n\n请输入数字(1-8):`, '1');

            if (choice === null) return; // 用户取消

            switch (choice.trim()) {
                case '1':
                    // 从GitHub加载UID黑名单
                    loadBlacklistFromGitHub(function (success) {
                        if (success) {
                            alert(`成功加载UID黑名单，共 ${config.UID_BLACKLIST.length} 个UID:\n\n${config.UID_BLACKLIST.join(', ')}`);
                        } else {
                            alert('加载UID黑名单失败，请检查控制台查看详细信息');
                        }
                    });
                    break;

                case '2':
                    // 查看当前UID黑名单（显示完整信息）
                    if (config.FULL_BLACKLIST && config.FULL_BLACKLIST.length > 0) {
                        // 格式化显示完整黑名单信息
                        const formattedList = config.FULL_BLACKLIST.map(item => {
                            if (typeof item === 'object' && item !== null && 'uid' in item) {
                                // 新格式：对象包含uid、name、remark字段
                                const uid = String(item.uid);
                                const name = item.name || '未知';
                                const remark = item.remark || '';
                                return `UID: ${uid}\n名称: ${name}${remark ? `\n备注: ${remark}` : ''}`;
                            } else {
                                // 旧格式：直接是UID
                                return `UID: ${String(item)}`;
                            }
                        }).join('\n\n');
                        
                        alert(`当前UID黑名单 (${config.FULL_BLACKLIST.length}个):\n\n${formattedList}`);
                    } else {
                        alert('黑名单为空（请先使用"从GitHub加载UID黑名单"菜单项加载）');
                    }
                    break;

                case '3':
                    // 查看当前UID白名单
                    const whitelistStr = config.UID_WHITELIST.length > 0
                        ? config.UID_WHITELIST.join('\n')
                        : '白名单为空';
                    alert(`当前UID白名单 (${config.UID_WHITELIST.length}个):\n\n${whitelistStr}`);
                    break;

                case '4':
                    // 添加当前UP主到白名单
                    const bv = getCurrentBV();
                    if (!bv) {
                        alert('无法获取当前视频BV号');
                        return;
                    }

                    const aid = bv2av(bv);

                    // 使用API获取视频信息
                    checkVideoInfo(aid, function (videoInfo) {
                        if (!videoInfo) {
                            alert('无法获取视频信息');
                            return;
                        }

                        if (!videoInfo.ownerMid) {
                            alert('无法获取UP主UID');
                            return;
                        }

                        if (addToWhitelist(videoInfo.ownerMid)) {
                            // 刷新页面以应用白名单
                            location.reload();
                        }
                    });
                    break;

                case '5':
                    // 从白名单中删除当前UP主
                    const bv2 = getCurrentBV();
                    if (!bv2) {
                        alert('无法获取当前视频BV号');
                        return;
                    }

                    const aid2 = bv2av(bv2);

                    // 使用API获取视频信息
                    checkVideoInfo(aid2, function (videoInfo) {
                        if (!videoInfo) {
                            alert('无法获取视频信息');
                            return;
                        }

                        if (!videoInfo.ownerMid) {
                            alert('无法获取UP主UID');
                            return;
                        }

                        if (removeFromWhitelist(videoInfo.ownerMid)) {
                            // 刷新页面以应用白名单
                            location.reload();
                        }
                    });
                    break;

                case '6':
                    // 从白名单中删除指定UID
                    const uidToRemove = prompt('请输入要从白名单中删除的UID:');
                    if (uidToRemove !== null && uidToRemove.trim() !== '') {
                        if (removeFromWhitelist(uidToRemove.trim())) {
                            // 刷新页面以应用白名单
                            location.reload();
                        }
                    }
                    break;

                case '7':
                    // 清空白名单
                    if (clearWhitelist()) {
                        // 刷新页面以应用白名单
                        location.reload();
                    }
                    break;

                case '8':
                    // 取消
                    break;

                default:
                    alert('无效的选择，请输入1-8之间的数字');
            }
        });

        // 切换主页屏蔽模式
        GM_registerMenuCommand(`主页屏蔽模式: ${getHomepageBlockModeText(config.HOMEPAGE_BLOCK_MODE)}`, function () {
            const modes = ['off', 'blur', 'remove'];
            const currentIndex = modes.indexOf(config.HOMEPAGE_BLOCK_MODE);
            const nextIndex = (currentIndex + 1) % modes.length;
            const newMode = modes[nextIndex];
            
            GM_setValue('HOMEPAGE_BLOCK_MODE', newMode);
            config.HOMEPAGE_BLOCK_MODE = newMode;
            
            alert(`主页屏蔽模式已切换为: ${getHomepageBlockModeText(newMode)}`);
            location.reload();
        });

        // 重置设置
        GM_registerMenuCommand('重置所有设置', function () {
            if (confirm('确定要重置所有设置吗？')) {
                GM_setValue('KEYWORDS', DEFAULT_CONFIG.KEYWORDS);
                GM_setValue('YOUTUBE_REGEX', DEFAULT_CONFIG.YOUTUBE_REGEX.source);
                GM_setValue('DELAY_TIME', DEFAULT_CONFIG.DELAY_TIME);
                GM_setValue('AUTO_JUMP', DEFAULT_CONFIG.AUTO_JUMP);
                GM_setValue('AUTO_REPORT', DEFAULT_CONFIG.AUTO_REPORT);
                GM_setValue('REPORT_DESCRIPTION', DEFAULT_CONFIG.REPORT_DESCRIPTION);
                GM_setValue('REPORT_HISTORY', DEFAULT_CONFIG.REPORT_HISTORY);
                GM_setValue('HOMEPAGE_BLOCK_MODE', DEFAULT_CONFIG.HOMEPAGE_BLOCK_MODE);
                alert('所有设置已重置为默认值');
                location.reload();
            }
        });
    }

    // 主功能
    function mainFunction() {
        const bv = getCurrentBV();
        if (!bv) {
            console.error('无法获取当前视频BV号');
            return;
        }

        const aid = bv2av(bv);

        // 检查视频信息（版权、UP主UID和简介）
        checkVideoInfo(aid, function (videoInfo) {
            if (!videoInfo) {
                console.log('无法获取视频信息，跳过处理');
                return;
            }

            // 首先检查白名单：如果在白名单中，直接跳过处理
            if (videoInfo.isWhitelisted) {
                console.log('UP主在白名单中，跳过处理');
                return;
            }

            // 对于黑名单UP主：无论标题是否有关键词，都继续检查
            // 对于非黑名单UP主：需要检查标题是否包含关键词
            if (!videoInfo.isBlacklisted) {
                // 检查标题是否包含关键词
                const containsKeyword = config.KEYWORDS.some(keyword =>
                    document.title.includes(keyword)
                );

                if (!containsKeyword) {
                    console.log('标题不包含关键词且UP主不在黑名单中，跳过处理');
                    return;
                }
            }

            // 判断是否为需要处理的视频：原创作品或UP主在黑名单中
            console.log('视频信息检查结果', videoInfo);
            const shouldProcess = videoInfo.isOriginal || videoInfo.isBlacklisted;

            if (!shouldProcess) {
                console.log('视频不是原创作品或者UP主不在黑名单中，跳过处理');
                return;
            }

            console.log('检测到需要处理的视频', {
                isOriginal: videoInfo.isOriginal,
                isBlacklisted: videoInfo.isBlacklisted,
                ownerMid: videoInfo.ownerMid,
                titleContainsKeyword: videoInfo.isBlacklisted ? '跳过检查' : '已检查'
            });

            // 直接从API返回的简介中检查YouTube链接
            const youtubeMatch = videoInfo.description.match(config.YOUTUBE_REGEX);

            if (!youtubeMatch || !youtubeMatch[0]) {
                console.log('未找到YouTube原始链接');
                // 这里区分一下是黑名单UP主还是关键词触发
                if (videoInfo.isBlacklisted) {
                    // 黑名单UP主的情况
                    if (confirm('此视频为黑名单UP主\n但是未找到原始视频链接\n无法为您跳转或者举报\n是否回到主页？')) {
                        window.location.href = 'https://www.bilibili.com/';
                    }
                    return;
                } else {
                    // 非黑名单UP主，只是标题匹配关键词的情况
                    if (confirm('此视频命中了关键词\n但是未找到原始视频链接\n如果您觉得这个UP主是正常的\n那么您可以给他加到白名单中\n确定：回到B站主页\n取消：留在此处')) {
                        window.location.href = 'https://www.bilibili.com/';
                    }
                    return;
                }
            }

            const youtubeUrl = youtubeMatch[0];

            setTimeout(function () {
                // 自动举报
                if (config.AUTO_REPORT) {
                    reportVideo(youtubeUrl);
                }

                // 跳转处理
                if (config.AUTO_JUMP) {
                    window.location.href = youtubeUrl;
                } else {
                    if (confirm('本视频为AI中配视频\n在简介找到了YouTube原始链接\n是否要跳转？')) {
                        window.location.href = youtubeUrl;
                    }
                }
            }, config.DELAY_TIME);
        });
    }

    // 主页视频屏蔽功能
    function blockHomepageVideos() {
        console.log('开始执行主页视频屏蔽功能，当前模式:', config.HOMEPAGE_BLOCK_MODE);
        
        // 检查是否在主页
        if (!window.location.href.startsWith('https://www.bilibili.com/')) {
            console.log('不在主页，跳过主页视频屏蔽');
            return;
        }
        
        // 如果模式是关闭，直接返回
        if (config.HOMEPAGE_BLOCK_MODE === 'off') {
            console.log('主页屏蔽模式为关闭，跳过处理');
            return;
        }
        
        // 获取所有视频卡片元素
        const videoCards = document.querySelectorAll('.feed-card');
        console.log(`找到 ${videoCards.length} 个视频卡片`);
        
        if (videoCards.length === 0) {
            console.log('未找到视频卡片，可能页面尚未加载完成，将在1秒后重试');
            setTimeout(blockHomepageVideos, 1000);
            return;
        }
        
        // 从完整黑名单中提取UP主名字列表
        const blacklistNames = config.FULL_BLACKLIST
            .filter(item => item && typeof item === 'object' && 'name' in item)
            .map(item => item.name.trim());
        
        console.log('黑名单UP主名字列表:', blacklistNames);
        
        let blockedCount = 0;
        
        // 遍历每个视频卡片
        videoCards.forEach((card, index) => {
            // 查找作者名字元素
            const authorElement = card.querySelector('.bili-video-card__info--author');
            if (!authorElement) {
                console.log(`卡片 ${index}: 未找到作者名字元素`);
                return;
            }
            
            const authorName = authorElement.textContent.trim();
            console.log(`卡片 ${index}: 作者名字: "${authorName}"`);
            
            // 检查作者名字是否在黑名单中
            const isBlacklisted = blacklistNames.some(name => 
                authorName.includes(name) || name.includes(authorName)
            );
            
            if (isBlacklisted) {
                console.log(`卡片 ${index}: 作者 "${authorName}" 在黑名单中，进行屏蔽`);
                
                // 根据模式处理
                if (config.HOMEPAGE_BLOCK_MODE === 'remove') {
                    // 移除模式：直接移除卡片
                    console.log(`移除卡片 ${index}: 作者 "${authorName}"`);
                    card.style.display = 'none';
                    blockedCount++;
                } else if (config.HOMEPAGE_BLOCK_MODE === 'blur') {
                    // 模糊化模式：添加模糊效果和屏蔽提示
                    console.log(`模糊化卡片 ${index}: 作者 "${authorName}"`);
                    
                    // 确保卡片有相对定位以便绝对定位覆盖层
                    if (window.getComputedStyle(card).position === 'static') {
                        card.style.position = 'relative';
                    }
                    
                    // 创建一个包装容器来应用模糊效果
                    const blurWrapper = document.createElement('div');
                    blurWrapper.style.filter = 'blur(5px)';
                    blurWrapper.style.opacity = '0.5';
                    blurWrapper.style.width = '100%';
                    blurWrapper.style.height = '100%';
                    blurWrapper.style.position = 'relative';
                    blurWrapper.style.zIndex = '1';
                    
                    // 将卡片的所有子节点移动到模糊包装器中
                    while (card.firstChild) {
                        blurWrapper.appendChild(card.firstChild);
                    }
                    
                    // 将模糊包装器添加回卡片
                    card.appendChild(blurWrapper);
                    
                    // 添加屏蔽提示（不模糊）
                    const blockOverlay = document.createElement('div');
                    blockOverlay.style.position = 'absolute';
                    blockOverlay.style.top = '0';
                    blockOverlay.style.left = '0';
                    blockOverlay.style.width = '100%';
                    blockOverlay.style.height = '100%';
                    blockOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
                    blockOverlay.style.color = 'white';
                    blockOverlay.style.display = 'flex';
                    blockOverlay.style.flexDirection = 'column';
                    blockOverlay.style.justifyContent = 'center';
                    blockOverlay.style.alignItems = 'center';
                    blockOverlay.style.zIndex = '1000';
                    blockOverlay.style.padding = '10px';
                    blockOverlay.style.boxSizing = 'border-box';
                    blockOverlay.style.textAlign = 'center';
                    blockOverlay.style.borderRadius = '8px';
                    blockOverlay.style.pointerEvents = 'none'; // 防止屏蔽提示干扰点击事件
                    
                    blockOverlay.innerHTML = `
                        <div style="font-size: 16px; font-weight: bold; margin-bottom: 8px; pointer-events: auto;">
                            ⚠️ 已屏蔽
                        </div>
                        <div style="font-size: 14px; margin-bottom: 4px; pointer-events: auto;">
                            作者: ${authorName}
                        </div>
                        <div style="font-size: 12px; opacity: 0.8; pointer-events: auto;">
                            该UP主在黑名单中
                        </div>
                    `;
                    
                    // 移除可能已存在的覆盖层
                    const existingOverlay = card.querySelector('.bili-block-overlay');
                    if (existingOverlay) {
                        existingOverlay.remove();
                    }
                    
                    blockOverlay.className = 'bili-block-overlay';
                    card.appendChild(blockOverlay);
                    
                    blockedCount++;
                }
            } else {
                console.log(`卡片 ${index}: 作者 "${authorName}" 不在黑名单中`);
            }
        });
        
        console.log(`主页视频屏蔽完成，共处理了 ${blockedCount} 个视频`);
        
        // 监听页面变化（B站主页是单页应用，内容可能会动态加载）
        observePageChanges();
    }
    
    // 监听页面变化
    function observePageChanges() {
        // 使用MutationObserver监听DOM变化
        const observer = new MutationObserver(function(mutations) {
            let shouldCheck = false;
            
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    // 检查新增的节点中是否有视频卡片
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.querySelector('.feed-card') || 
                                (node.classList && node.classList.contains('feed-card'))) {
                                shouldCheck = true;
                                break;
                            }
                        }
                    }
                }
                
                if (shouldCheck) break;
            }
            
            if (shouldCheck) {
                console.log('检测到页面内容变化，重新检查视频卡片');
                // 防抖处理，避免频繁调用
                clearTimeout(window._blockHomepageDebounce);
                window._blockHomepageDebounce = setTimeout(blockHomepageVideos, 500);
            }
        });
        
        // 开始观察整个文档的变化
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        console.log('已启动页面变化监听');
    }
    
    // 根据当前URL决定执行哪个功能
    function init() {
        registerMenuCommands();
        
        // 自动加载黑名单
        loadBlacklistFromGitHub(function (success) {
            if (success) {
                console.log('UID黑名单加载成功');
                
                // 根据当前URL决定执行哪个功能
                const currentUrl = window.location.href;
                
                if (currentUrl.includes('/video/BV')) {
                    // 视频页面：执行原来的主功能
                    console.log('当前在视频页面，执行主功能');
                    mainFunction();
                } else if (currentUrl.startsWith('https://www.bilibili.com/')) {
                    // 主页：执行主页视频屏蔽功能
                    console.log('当前在主页，执行主页视频屏蔽功能');
                    
                    // 等待页面加载完成
                    if (document.readyState === 'loading') {
                        document.addEventListener('DOMContentLoaded', blockHomepageVideos);
                    } else {
                        // 如果页面已经加载完成，直接执行
                        setTimeout(blockHomepageVideos, 1000);
                    }
                } else {
                    console.log('当前页面不在处理范围内');
                }
            } else {
                console.log('UID黑名单加载失败');
                
                // 即使黑名单加载失败，也根据URL执行相应功能
                const currentUrl = window.location.href;
                
                if (currentUrl.includes('/video/BV')) {
                    console.log('当前在视频页面，使用空黑名单执行主功能');
                    mainFunction();
                }
            }
        });
    }

    // 初始化
    init();
})();
