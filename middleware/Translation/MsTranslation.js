const axios = require('axios');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { once } = require('events');

// models
const Translations = require('../../models/Translations');

// constants
const TRANSLATOR_NAME = 'MICROSOFT_TRANSLATION';
const CHARACTER_LIMIT_FOR_ONE_REQUEST = 4000;
const CHARACTER_LIMIT_DELIMITER = '||';

/**
 * @typedef {Object} MsTextRequest
 * @property {string} Text 
 * 
 * @typedef {Object} MsRequestData
 * @property {number} totalCharLength
 * @property {Array.<MsTextRequest>} textArray
 * 
 * @typedef {Object} MsText
 * @property {string} text 
 * 
 * @typedef {Object} MsTranslationResponse
 * @property {Array.<MsText>} translations 
 */

/**
 * @function _constructRequestData
 * @param {Buffer} data 
 * @returns {MsRequestData}
 */
const _constructRequestData = (data) => {
  console.log('[_constructRequestData] START');

  if (!data instanceof Buffer)
    throw new Error('Data is not a instance of Buffer');

  let totalCharLength = 0;
  let textArray = [];
  let counter = 1;

  const dataArray = data.toString().split(/(?:\r\n|\r|\n)/g);

  for (let i = 0; i < dataArray.length; i++) {
    if (!dataArray[i]) {
      textArray.push({ 'Text': '' });
      continue;
    }

    const lineArr = dataArray[i].split('.');

    for (let j = 0; j < lineArr.length; j++) {
      let text = lineArr[j].trim() ? lineArr[j] + '.' : '';

      textArray.push({ 'Text': text });

      totalCharLength += text.length;

      if (totalCharLength >= (counter * CHARACTER_LIMIT_FOR_ONE_REQUEST)) {
        textArray.push(CHARACTER_LIMIT_DELIMITER);
        counter++;
      }
    }
  }

  console.log('[_constructRequestData] END');
  return {
    totalCharLength,
    textArray
  };
}

/**
 * @async
 * @function _getNewToken
 * @description Get a new token by sending an http request to microsoft translation
 * @returns {Promise<string>} token
 */
const _getNewToken = async () => {
  const getToken = await axios({
    method: 'POST',
    url: process.env.MS_TRANSLATION_TEXT_ACCESS_TOKEN_URL,
    headers: { 'Ocp-Apim-Subscription-Key': process.env.MS_TRANSLATION_TEXT_SUBSCRIPTION_KEY },
    data: ''
  });
  return new Promise(resolve => resolve(getToken.data));
}

/**
 * @async
 * @function _getTranslationToken
 * @description Time the generation of new token
 * @returns {string} token
 */
const _getTranslationToken = async () => {
  console.log('[_getTranslationToken] START');

  let token = null;

  let translations = await Translations.findOne({ name: TRANSLATOR_NAME });
  if (!translations || !translations.name) {
    const newTranslationRecord = new Translations({ name: TRANSLATOR_NAME });
    translations = await newTranslationRecord.save({});
  }

  token = translations.token;
  const prevTime = translations.time_last_requested;
  const intervalTime = translations.time_interval;

  const currentTime = Date.now();
  const timeDiff = prevTime ? currentTime - prevTime : intervalTime;

  if (timeDiff >= intervalTime) {
    // get a new token
    token = await _getNewToken();

    // update the record
    await Translations.updateOne(
      { _id: translations._id },
      {
        $set: {
          token: token,
          time_last_requested: currentTime
        }
      }
    );
  }

  console.log('[_getTranslationToken] END');
  return token;
}

/**
 * @async
 * @function _constructSendRequest
 * @description the function to send translation request
 * @param {Array.<Object>} requestData - an array of texts
 * @param {string} fromLanguage - original language
 * @param {string} toLanguage - target language
 * @returns {Array.<Object>} an array of objects
 */
const _constructSendRequest = async (requestData, fromLanguage, toLanguage) => {
  console.log('[_constructSendRequest] START');

  // get the microsoft token
  const token = await _getTranslationToken();

  const url = process.env.MS_TRANSLATION_TEXT_BASE_URL + `&from=${fromLanguage}&to=${toLanguage}&textType=plain`;

  const msTranslationResult = await axios({
    method: 'POST',
    url: url,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: requestData
  });
  if (msTranslationResult.data.error) throw res.data.error;

  console.log('[_constructSendRequest] END');
  return msTranslationResult.data;
}

/**
 * @function _constructRequest
 * @description divide the texts into multiple requests based on character limit
 * @param {Array.<Object>} inputArray - an array of texts
 * @param {string} fromLanguage - original language
 * @param {string} toLanguage - target language
 * @returns {Array.<Function>} an array of Objects, each object value is a '_constructSendRequest' function
 */
const _constructRequest = (inputArray, fromLanguage, toLanguage) => {

  const sendRequestFunction = {};

  // divide the 'inputArray' based on delimiter
  // save the indices of the division
  const indices = [];
  let idx = inputArray.indexOf(CHARACTER_LIMIT_DELIMITER);
  while (idx !== -1) {
    indices.push(idx);
    idx = inputArray.indexOf(CHARACTER_LIMIT_DELIMITER, idx + 1);
  }
  indices.push(inputArray.length);

  // create a dictionary
  // each element of the dictionary is a function
  // example: { function_<index> : _constructSendRequest(args) }
  for (let i = 0; i < indices.length; i++) {
    let arrSliced = null;
    if (i === 0) {
      arrSliced = inputArray.slice(0, indices[i]);
    } else {
      arrSliced = inputArray.slice(indices[i - 1] + 1, indices[i]);
    }
    sendRequestFunction['function_' + i] = () => {
      return _constructSendRequest(arrSliced, fromLanguage, toLanguage);
    }
  }

  return sendRequestFunction;
}

/**
 * @async
 * @function _sendRequest
 * @description send the request(s) to microsoft translation API
 * @param {Array.<Function>} requests
 * @returns {Promise<Array.<MsTranslationResponse>>}
 */
const _sendRequest = async (requests) => {
  const responseArray = [];
  const sendRequestFunction = Object.keys(requests);

  for (let i = 0; i < sendRequestFunction.length; i++) {
    const f1 = await requests[sendRequestFunction[i]]();
    responseArray.push(...f1);
  }

  return new Promise(resolve => resolve(responseArray));
}

/**
 * @function _consolidateResponseArray
 * @description organize the response from microsoft translation API
 * @param {Array.<MsTranslationResponse>} responseArray
 * @returns {Array.<string>} an array of string
 */
const _consolidateResponseArray = responseArray => {
  const textArray = [];
  for (let i = 0; i < responseArray.length; i++) {
    const text = responseArray[i]['translations'][0]['text'];
    textArray.push(text);
  }
  return textArray;
}

const _readPlainTextFile = async (filepath, filename) => {
  console.log('[_readPlainTextFile] START');

  const file = path.join(__dirname, `../${filepath}/${filename}`);

  let totalCharLength = 0;
  let textArray = [];
  let counter = 1;

  // readline.Interface -> input is a stream
  // Note: we use the crlfDelay option to recognize all instances of CR LF ('\r\n') in input.txt as a single line break.
  const readInterface = readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity
  });

  readInterface.on('line', function (line) {

    if (line) {
      const lineArr = line.split('.');

      for (let i = 0; i < lineArr.length; i++) {
        let text = lineArr[i].trim() ? lineArr[i] + '.' : '';

        textArray.push({ 'Text': text });

        totalCharLength += text.length;

        if (totalCharLength >= (counter * CHARACTER_LIMIT_FOR_ONE_REQUEST)) {
          textArray.push(CHARACTER_LIMIT_DELIMITER);
          counter++;
        }
      }

      textArray.push({ 'Text': '' });
    }

  });

  await once(readInterface, 'close');

  console.log('[_readPlainTextFile] END');

  return {
    totalCharLength,
    textArray
  };
}

const _writeFile = async (filepath, filename, textArray) => {
  console.log('[_writeFile] START');

  // const dir = path.join(__dirname, `../../../test_file/${filename}`); // local for test
  const dir = path.join(__dirname, `../${filepath}/${filename}`);

  // to know more about flags, visit: https://nodejs.org/api/fs.html#fs_file_system_flags
  const stream = fs.createWriteStream(dir, { flags: 'w', encoding: 'utf8', emitClose: true });

  stream.once('open', function (fd) {
    let text = '';
    for (let i = 0; i < textArray.length; i++) {
      const data = textArray[i];

      if (!data || i === textArray.length - 1) {
        stream.write(text);
        stream.write('\n');

        text = '';
      } else {
        text += data;
      }

    }
    stream.end();
  });

  await once(stream, 'close');
  console.log('[_writeFile] END');
}

class MsTranslation {
  constructor() { }

  /**
   * @async
   * @function translate
   * @description divide the texts into multiple requests based on character limit
   * @param {Buffer|Object} data - data with type of Buffer
   * @param {string} fromLanguage - original language
   * @param {string} toLanguage - target language
   * @returns {Promise<Object>} totalCharLength<number> and textArray<string[]>
   */
  async translate(data, fromLanguage, toLanguage) {
    const readfileResult = data instanceof Buffer ? _constructRequestData(data) : data;

    if (!readfileResult || !readfileResult.textArray || readfileResult.textArray.length === 0)
      throw new Error('[MsTranslation.js] something went wrong');

    const requests = _constructRequest(readfileResult.textArray, fromLanguage, toLanguage);
    const responseArray = await _sendRequest(requests);
    const textArray = _consolidateResponseArray(responseArray);
    return new Promise(resolve => resolve({ totalCharLength: readfileResult.totalCharLength, textArray }));
  }

  /**
   * @async
   * @function readPlainTextFile
   * @description read from local file, plain/text
   * @param {string} filepath - example: '../../test_file'
   * @param {string} filename - example: 'filename.txt'
   * @returns {Promise<Object>} totalCharLength<number> and textArray<string[]>
   */
  async readPlainTextFile(filepath, filename) {
    const readfileResult = await _readPlainTextFile(filepath, filename);
    return new Promise(resolve => resolve({ totalCharLength: readfileResult.totalCharLength, textArray: readfileResult.textArray }));
  }

  /**
   * @async
   * @function writeFile
   * @description write an array of text into a physical file
   * @param {string} filepath - example: '../../test_file'
   * @param {string} filename - example: 'filename.txt'
   * @param {Array.<string>} textArray
   */
  async writeFile(filepath, filename, textArray) {
    await _writeFile(filepath, filename, textArray);
  }

  constructRequestDataFromBuffer(data) {
    if (!(data instanceof Buffer))
      throw new Error('input is not an instance of Buffer');

    const readfileResult = _constructRequestData(data);

    return { totalCharLength: readfileResult.totalCharLength, textArray: readfileResult.textArray };
  }
}

module.exports = MsTranslation;