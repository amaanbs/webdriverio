import url from 'node:url'
import yauzl from 'yauzl'

const fs = require('node:fs')
import { https } from 'follow-redirects'

import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { PercyLogger } from './PercyLogger'

class PercyBinary {
    #hostOS = process.platform
    #httpPath: any = null
    #binaryName = 'percy'

    #orderedPaths = [
        path.join(this.#homedir(), '.browserstack'),
        process.cwd(),
        os.tmpdir()
    ]

    constructor() {
        const base = 'https://github.com/percy/cli/releases/latest/download'
        if (this.#hostOS.match(/darwin|mac os/i)) {
            this.#httpPath = base + '/percy-osx.zip'
        } else if (this.#hostOS.match(/mswin|msys|mingw|cygwin|bccwin|wince|emc|win32/i)) {
            this.#httpPath = base + '/percy-win.zip'
            this.#binaryName = 'percy.exe'
        } else {
            this.#httpPath = base + '/percy-linux.zip'
        }
    }

    #homedir(): any {
        if (typeof os.homedir === 'function') {
            return os.homedir()
        }

        const env = process.env
        const home = env.HOME
        const user = env.LOGNAME || env.USER || env.LNAME || env.USERNAME

        if (process.platform === 'win32') {
            return env.USERPROFILE || (env.HOMEDRIVE || 'null') + env.HOMEPATH || home || null
        }

        if (process.platform === 'darwin') {
            return home || (user ? '/Users/' + user : null)
        }

        if (process.platform === 'linux') {
            return home || (process.getuid && process.getuid() === 0 ? '/root' : (user ? '/home/' + user : null))
        }

        return home || null
    }

    #makePath(path: string) {
        try {
            if (!this.#checkPath(path)) {
                fs.mkdirSync(path)
            }
            return true
        } catch {
            return false
        }
    }

    #checkPath(path: string, mode?: any) {
        mode = mode || (fs.R_OK | fs.W_OK)
        try {
            fs.accessSync(path, mode)
            return true
        } catch (e) {
            if (typeof fs.accessSync !== 'undefined') {
                return false
            }

            // node v0.10
            try {
                fs.statSync(path)
                return true
            } catch (e) {
                return false
            }
        }
    }

    #getAvailableDirs() {
        for (let i = 0; i < this.#orderedPaths.length; i++) {
            const path = this.#orderedPaths[i]
            if (this.#makePath(path)) {
                return path
            }
        }
        throw new Error('Error trying to download percy binary')
    }

    async getBinaryPath(conf: any): Promise<string> {
        const destParentDir = this.#getAvailableDirs()
        const binaryPath = path.join(destParentDir, this.#binaryName)
        if (this.#checkPath(binaryPath, fs.X_OK)) {
            return binaryPath
        }
        const downloadedBinaryPath: string = await this.download(conf, destParentDir)
        const isValid = await this.validateBinary(downloadedBinaryPath)
        if (!isValid) {
            // retry once
            PercyLogger.error('Corrupt percy binary, retrying')
            return await this.download(conf, destParentDir)
        }
        return downloadedBinaryPath
    }

    async validateBinary(binaryPath: string) {
        const versionRegex = /^.*@percy\/cli \d.\d+.\d+/
        /* eslint-disable @typescript-eslint/no-unused-vars */
        return new Promise((resolve, reject) => {
            const proc = spawn(binaryPath, ['--version'])
            proc.stdout.on('data', (data) => {
                if (versionRegex.test(data)) {
                    resolve(true)
                }
            })

            proc.on('close', () => {
                resolve(false)
            })
        })
    }

    download(conf: any, destParentDir: any): Promise<string> {
        if (!this.#checkPath(destParentDir)){
            fs.mkdirSync(destParentDir)
        }

        const binaryName = this.#binaryName
        const zipFilePath = path.join(destParentDir, binaryName + '.zip')
        const binaryPath = path.join(destParentDir, binaryName)
        const downloadedFileStream = fs.createWriteStream(zipFilePath)

        const options: any = url.parse(this.#httpPath)

        return new Promise((resolve, reject) => {
            https.get(options, function (response: any) {
                response.pipe(downloadedFileStream)
                response.on('error', function (err: any) {
                    PercyLogger.error('Got Error in percy binary download response : ' + err)
                    reject(err)
                })
                downloadedFileStream.on('error', function (err: any) {
                    PercyLogger.error('Got Error while downloading percy binary file : ' + err)
                    reject(err)
                })
                downloadedFileStream.on('close', function () {
                    yauzl.open(zipFilePath, { lazyEntries: true }, function (err: any, zipfile: any) {
                        if (err) {
                            return reject(err)
                        }
                        zipfile.readEntry()
                        zipfile.on('entry', (entry: any) => {
                            if (/\/$/.test(entry.fileName)) {
                                // Directory file names end with '/'.
                                zipfile.readEntry()
                            } else {
                                // file entry
                                const writeStream = fs.createWriteStream(
                                    path.join(destParentDir, entry.fileName)
                                )
                                zipfile.openReadStream(entry, function (zipErr: any, readStream: any) {
                                    if (zipErr) {
                                        reject(err)
                                    }
                                    readStream.on('end', function () {
                                        writeStream.close()
                                        zipfile.readEntry()
                                    })
                                    readStream.pipe(writeStream)
                                })

                                if (entry.fileName === binaryName) {
                                    zipfile.close()
                                }
                            }
                        })

                        zipfile.on('error', (zipErr: any) => {
                            reject(zipErr)
                        })

                        zipfile.once('end', () => {
                            fs.chmod(binaryPath, '0755', function (zipErr: any) {
                                if (zipErr) {
                                    reject(zipErr)
                                }
                                resolve(binaryPath)
                            })
                            zipfile.close()
                        })
                    })
                })
            }).on('error', function (err: any) {
                PercyLogger.error('Got Error in percy binary downloading request : ' + err)
                reject(err)
            })
        })
    }
}

export default PercyBinary