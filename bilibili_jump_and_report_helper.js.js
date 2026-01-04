// ==UserScript==
// @name         B站中配视频跳转与举报助手
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  自动检测B站中配视频，提供跳转和举报功能
// @author       YourName
// @match        https://www.bilibili.com/video/BV*
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @connect      api.bilibili.com
// ==/UserScript==

(function() {
    'use strict';

    // 默认配置
    const DEFAULT_CONFIG = {
        KEYWORDS: ['中配', '中字'],
        YOUTUBE_REGEX: /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[^\s]+/gi,
        DELAY_TIME: 1500,
        AUTO_JUMP: false,
        AUTO_REPORT: false,
        DESC_SELECTOR: '.desc-info-text',
        REPORT_DESCRIPTION: "转载投自制，原视频链接为：${YOUTUBE_URL}"
    };

    // 获取配置
    const config = {
        KEYWORDS: GM_getValue('KEYWORDS', DEFAULT_CONFIG.KEYWORDS),
        YOUTUBE_REGEX: new RegExp(GM_getValue('YOUTUBE_REGEX', DEFAULT_CONFIG.YOUTUBE_REGEX.source), 'gi'),
        DELAY_TIME: GM_getValue('DELAY_TIME', DEFAULT_CONFIG.DELAY_TIME),
        AUTO_JUMP: GM_getValue('AUTO_JUMP', DEFAULT_CONFIG.AUTO_JUMP),
        AUTO_REPORT: GM_getValue('AUTO_REPORT', DEFAULT_CONFIG.AUTO_REPORT),
        DESC_SELECTOR: GM_getValue('DESC_SELECTOR', DEFAULT_CONFIG.DESC_SELECTOR),
        REPORT_DESCRIPTION: GM_getValue('REPORT_DESCRIPTION', DEFAULT_CONFIG.REPORT_DESCRIPTION)
    };

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
            onload: function(response) {
                try {
                    const result = JSON.parse(response.responseText);
                    if (result.code === 0) {
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
            onerror: function(error) {
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

    // 注册菜单命令
    function registerMenuCommands() {
        // 切换自动跳转
        GM_registerMenuCommand(`自动跳转: ${config.AUTO_JUMP ? '开启' : '关闭'}`, function() {
            const newValue = !config.AUTO_JUMP;
            GM_setValue('AUTO_JUMP', newValue);
            config.AUTO_JUMP = newValue;
            alert(`自动跳转已${newValue ? '开启' : '关闭'}`);
            location.reload();
        });

        // 切换自动举报
        GM_registerMenuCommand(`自动举报: ${config.AUTO_REPORT ? '开启' : '关闭'}`, function() {
            const newValue = !config.AUTO_REPORT;
            GM_setValue('AUTO_REPORT', newValue);
            config.AUTO_REPORT = newValue;
            alert(`自动举报已${newValue ? '开启' : '关闭'}`);
            location.reload();
        });

        // 设置延迟时间
        GM_registerMenuCommand(`设置延迟时间 (当前: ${config.DELAY_TIME}ms)`, function() {
            const newDelay = prompt('请输入延迟时间（毫秒）:', config.DELAY_TIME);
            if (newDelay !== null && !isNaN(newDelay) && newDelay >= 0) {
                GM_setValue('DELAY_TIME', parseInt(newDelay));
                config.DELAY_TIME = parseInt(newDelay);
                alert(`延迟时间已设置为: ${newDelay}ms`);
                location.reload();
            }
        });

        // 设置关键词
        GM_registerMenuCommand(`设置关键词 (当前: ${config.KEYWORDS.join(', ')})`, function() {
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
        GM_registerMenuCommand(`设置举报描述 (当前: ${config.REPORT_DESCRIPTION})`, function() {
            const newDesc = prompt('请输入举报描述:', config.REPORT_DESCRIPTION);
            if (newDesc !== null && newDesc.trim() !== '') {
                GM_setValue('REPORT_DESCRIPTION', newDesc);
                config.REPORT_DESCRIPTION = newDesc;
                alert(`举报描述已设置为: ${newDesc}`);
            }
        });

        // 手动举报当前视频
        GM_registerMenuCommand('手动举报当前视频', function() {
            const bv = getCurrentBV();
            if (!bv) {
                alert('无法获取当前视频BV号');
                return;
            }

            const descElement = document.querySelector(config.DESC_SELECTOR);
            if (!descElement) {
                alert('无法找到视频简介');
                return;
            }

            const description = descElement.textContent;
            const youtubeMatch = description.match(config.YOUTUBE_REGEX);

            if (!youtubeMatch || !youtubeMatch[0]) {
                alert('无法找到YouTube原始链接');
                return;
            }

            const youtubeUrl = youtubeMatch[0];

            if (confirm(`确定要举报当前视频 (BV${bv}) 吗？`)) {
                reportVideo(youtubeUrl);
            }
        });

        // 重置设置
        GM_registerMenuCommand('重置所有设置', function() {
            if (confirm('确定要重置所有设置吗？')) {
                GM_setValue('KEYWORDS', DEFAULT_CONFIG.KEYWORDS);
                GM_setValue('YOUTUBE_REGEX', DEFAULT_CONFIG.YOUTUBE_REGEX.source);
                GM_setValue('DELAY_TIME', DEFAULT_CONFIG.DELAY_TIME);
                GM_setValue('AUTO_JUMP', DEFAULT_CONFIG.AUTO_JUMP);
                GM_setValue('AUTO_REPORT', DEFAULT_CONFIG.AUTO_REPORT);
                GM_setValue('DESC_SELECTOR', DEFAULT_CONFIG.DESC_SELECTOR);
                GM_setValue('REPORT_DESCRIPTION', DEFAULT_CONFIG.REPORT_DESCRIPTION);
                alert('所有设置已重置为默认值');
                location.reload();
            }
        });
    }

    // 主功能
    function mainFunction() {
        // 检查标题是否包含关键词
        const containsKeyword = config.KEYWORDS.some(keyword =>
            document.title.includes(keyword)
        );

        if (containsKeyword) {
            window.addEventListener('load', function() {
                const descElement = document.querySelector(config.DESC_SELECTOR);
                if (descElement) {
                    const description = descElement.textContent;
                    const youtubeMatch = description.match(config.YOUTUBE_REGEX);

                    if (youtubeMatch && youtubeMatch[0]) {
                        const youtubeUrl = youtubeMatch[0];
                        const bv = getCurrentBV();

                        setTimeout(function() {
                            // 自动举报
                            if (config.AUTO_REPORT && bv) {
                                reportVideo(youtubeUrl);
                            }

                            // 跳转处理
                            if (config.AUTO_JUMP) {
                                window.location.href = youtubeUrl;
                            } else {
                                if (confirm('检测到YouTube原始链接，是否要跳转？')) {
                                    window.location.href = youtubeUrl;
                                }
                            }
                        }, config.DELAY_TIME);
                    }
                }
            });
        }
    }

    // 初始化
    registerMenuCommands();
    mainFunction();
})();