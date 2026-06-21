'use strict';
/**
 * Константы путей
 *
 * Файлы логина клиента ZCode (Windows):
 *   %USERPROFILE%\.zcode\v2\credentials.json   -> зашифрованные OAuth token (enc:v1:...)
 *   %USERPROFILE%\.zcode\v2\config.json        -> apiKey JWT каждого provider (открытый, содержит user_id)
 *   %APPDATA%\ZCode\ZCode.exe                  -> клиент ZCode
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

const HOME = os.homedir();
const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');

// Каталог данных ZCode
const ZCODE_V2_DIR = path.join(HOME, '.zcode', 'v2');

// Файлы логина (эти два файла составляют полный снимок аккаунта)
const CREDENTIALS_FILE = path.join(ZCODE_V2_DIR, 'credentials.json');
const CONFIG_FILE = path.join(ZCODE_V2_DIR, 'config.json');

// Кандидаты каталога установки ZCode (по приоритету, первый существующий будет использован)
const PROGRAM_FILES = process.env.ProgramFiles || 'C:\\Program Files';
const PROGRAM_FILES_X86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
const LOCAL_APPDATA = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
const ZCODE_EXE_CANDIDATES = [
  path.join(PROGRAM_FILES, 'ZCode', 'ZCode.exe'),
  path.join(PROGRAM_FILES_X86, 'ZCode', 'ZCode.exe'),
  path.join(LOCAL_APPDATA, 'Programs', 'ZCode', 'ZCode.exe'),
  path.join(APPDATA, '..', 'Local', 'Programs', 'ZCode', 'ZCode.exe'),
  'D:\\Program Files\\ZCode\\ZCode.exe',
];

// Каталог хранения снимков аккаунтов (в каталоге инструмента, не загрязняет v2)
const STORE_DIR = path.join(__dirname, '..', 'accounts');

/**
 * Найти фактический путь к ZCode.exe
 */
function findZCodeExe() {
  for (const p of ZCODE_EXE_CANDIDATES) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return null;
}

module.exports = {
  HOME,
  APPDATA,
  ZCODE_V2_DIR,
  CREDENTIALS_FILE,
  CONFIG_FILE,
  ZCODE_EXE_CANDIDATES,
  STORE_DIR,
  findZCodeExe,
};
