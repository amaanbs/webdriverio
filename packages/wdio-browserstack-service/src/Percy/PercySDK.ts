const tryRequire = function (pkg: string, fallback: any) {
    try {
        return require(pkg)
    } catch {
        return fallback
    }
}

import type { Browser, MultiRemoteBrowser } from 'webdriverio'

// const percySnapshot = tryRequire('@percy/webdriverio', null);
const percySnapshot = tryRequire('@percy/selenium-webdriver', null)
const { percyScreenshot } = tryRequire('@percy/selenium-webdriver', {})
const percyAppScreenshot = require('@percy/appium-app')

import { PercyLogger } from './PercyLogger'

/* eslint-disable @typescript-eslint/no-unused-vars */
let snapshotHandler = (...args: any[]) => {
    PercyLogger.error('Unsupported driver for percy')
}
if (percySnapshot) {
    snapshotHandler = (browser: Browser<'async'> | MultiRemoteBrowser<'async'>, name: string) => {
        if (process.env.PERCY_SNAPSHOT === 'true') {
            return percySnapshot(browser, name)
        }
    }
}
export const snapshot = snapshotHandler

/* eslint-disable @typescript-eslint/no-unused-vars */
let screenshotHandler = async (...args: any[]) => {
    PercyLogger.error('Unsupported driver for percy')
}
if (percyScreenshot) {
    screenshotHandler = percyScreenshot
}
export const screenshot = screenshotHandler

export const screenshotApp = percyAppScreenshot