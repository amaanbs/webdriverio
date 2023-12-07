import https from 'https';
import url from 'url';
import yauzl from 'yauzl';

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const fs = require('fs');

import path from 'node:path';
import os from 'node:os';
import { spawn } from 'child_process';
import HttpsProxyAgent from 'https-proxy-agent';
import { PercyLogger } from './PercyLogger.js'

class PercyBinary {
  #hostOS = process.platform;
  #httpPath: any = null;
  #binaryName = "percy";

  #orderedPaths = [
    path.join(this.#homedir(), '.browserstack'),
    process.cwd(),
    os.tmpdir()
  ];

  constructor() {
    const base = "https://github.com/percy/cli/releases/latest/download";
    if (this.#hostOS.match(/darwin|mac os/i)) {
      this.#httpPath = base + "/percy-osx.zip"
    } else if (this.#hostOS.match(/mswin|msys|mingw|cygwin|bccwin|wince|emc|win32/i)) {
      this.#httpPath = base + "/percy-win.zip"
      this.#binaryName = "percy.exe";
    } else {
      this.#httpPath = base + "/percy-linux.zip"
    }
  }

  #homedir(): any {
    if (typeof os.homedir === 'function') return os.homedir();

    const env = process.env;
    const home = env.HOME;
    const user = env.LOGNAME || env.USER || env.LNAME || env.USERNAME;

    if (process.platform === 'win32') {
      return env.USERPROFILE || (env.HOMEDRIVE || 'null') + env.HOMEPATH || home || null;
    }

    if (process.platform === 'darwin') {
      return home || (user ? '/Users/' + user : null);
    }

    if (process.platform === 'linux') {
      return home || (process.getuid && process.getuid() === 0 ? '/root' : (user ? '/home/' + user : null));
    }

    return home || null;
  }

  #makePath(path: string) {
    try {
      if (!this.#checkPath(path)) {
        fs.mkdirSync(path);
      }
      return true;
    } catch {
      return false;
    }
  }

  #checkPath(path: string, mode?: any) {
    mode = mode || (fs.R_OK | fs.W_OK);
    try {
      fs.accessSync(path, mode);
      return true;
    } catch (e) {
      if (typeof fs.accessSync !== 'undefined') return false;

      // node v0.10
      try {
        fs.statSync(path);
        return true;
      } catch (e) {
        return false;
      }
    }
  }

  #getAvailableDirs() {
    for (var i = 0; i < this.#orderedPaths.length; i++) {
      var path = this.#orderedPaths[i];
      if (this.#makePath(path))
        return path;
    }
    throw new Error('Error trying to download percy binary');
  }
 
  async getBinaryPath(conf: any): Promise<string> {
    var destParentDir = this.#getAvailableDirs();
    var binaryPath = path.join(destParentDir, this.#binaryName);
    if (this.#checkPath(binaryPath, fs.X_OK)) {
      return binaryPath;
    } else {
      const downloadedBinaryPath: string = await this.download(conf, destParentDir);
      const isValid = await this.validateBinary(downloadedBinaryPath);
      if (!isValid) {
        // retry once
        PercyLogger.error('Corrupt percy binary, retrying')
        return await this.download(conf, destParentDir)
      }
      return downloadedBinaryPath;
    }
  }

  async validateBinary(binaryPath: string) {
    const versionRegex = /^.*@percy\/cli \d.\d+.\d+/
    return new Promise((resolve, reject) => {
      const proc = spawn(binaryPath, ['--version'])
      proc.stdout.on('data', (data) => {
        if (versionRegex.test(data)) {
          resolve(true);
        }
      })

      proc.on('close', () => {
        resolve(false);
      })
    })
  }

  download(conf: any, destParentDir: any): Promise<string> {
    if(!this.#checkPath(destParentDir)){
        fs.mkdirSync(destParentDir)
    }

    const binaryName = this.#binaryName;
    const zipFilePath = path.join(destParentDir, binaryName + ".zip");
    const binaryPath = path.join(destParentDir, binaryName);
    const downloadedFileStream = fs.createWriteStream(zipFilePath);

    const options: any = url.parse(this.#httpPath);
    if (conf.proxyHost && conf.proxyPort) {
      options.agent = new (HttpsProxyAgent as any)({
        host: conf.proxyHost,
        port: conf.proxyPort
      });
    }
    if (conf.useCaCertificate) {
      try {
        options.ca = fs.readFileSync(conf.useCaCertificate);
      } catch (err) {
        PercyLogger.error("Percy download failed to read cert file : " + err)
      }
    }

    return new Promise((resolve, reject) => {
      https.get(options, function (response: any) {
        response.pipe(downloadedFileStream);
        response.on('error', function (err: any) {
          PercyLogger.error('Got Error in percy binary download response : ' + err);
          reject(err);
        });
        downloadedFileStream.on('error', function (err: any) {
          PercyLogger.error('Got Error while downloading percy binary file : ' + err);
          reject(err)
        });
        downloadedFileStream.on('close', function () {
          yauzl.open(zipFilePath, { lazyEntries: true }, function (err, zipfile) {
            if (err) reject(err);
            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
              if (/\/$/.test(entry.fileName)) {
                // Directory file names end with '/'.
                zipfile.readEntry();
              } else {
                // file entry
                const writeStream = fs.createWriteStream(
                  path.join(destParentDir, entry.fileName)
                )
                zipfile.openReadStream(entry, function (zipErr, readStream) {
                  if (zipErr) reject(err);
                  readStream.on("end", function () {
                    writeStream.close();
                    zipfile.readEntry();
                  });
                  readStream.pipe(writeStream);
                });

                if (entry.fileName == binaryName) {
                  zipfile.close();
                }
              }
            });

            zipfile.on('error', (zipErr) => {
              reject(zipErr);
            })

            zipfile.once('end', () => {
              fs.chmod(binaryPath, '0755', function (zipErr: any) {
                if (zipErr) {
                  reject(zipErr)
                }
                resolve(binaryPath);
              });
              zipfile.close();
            })
          });
        });
      }).on('error', function (err: any) {
        PercyLogger.error('Got Error in percy binary downloading request : ' + err);
        reject(err)
      });
    })
  }
}

export default PercyBinary
