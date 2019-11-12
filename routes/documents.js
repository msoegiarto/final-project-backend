const Router = require('express').Router;
const ObjectId = require('mongoose').Types.ObjectId;
const JSZip = require('jszip');
const MsTranslation = require('../middleware/Translation/MsTranslation');

const router = new Router();
const msTranslation = new MsTranslation();

// Users model
const Users = require('../models/Users');
const Userfiles = require('../models/Userfiles');

/**
 * @POST /api/translate/documents
 * 
 */
router.post('/', async (req, res, next) => {
  try {
    const thisUser = _getUserFromRequest(req);
    const userFound = await _findUserAndPopulateFiles(thisUser);

    const returnValue = {};

    if (!(userFound && userFound.email && userFound.authentication)) {
      await _saveUser(thisUser);
      returnValue.msg = `user saved`;
      returnValue.translatedFiles = [];
    } else {
      const translatedFiles = _getTranslatedFiles(userFound.user_files);
      returnValue.msg = translatedFiles.length > 0 ? `user has files` : `user has no files`;
      returnValue.translatedFiles = translatedFiles;
    }

    return res.json(returnValue);
  } catch (err) {
    res.status(500).json({ err });
    next(err);
  }
});

/**
 * @POST /api/translate/documents/translate
 * 
 */
router.post('/translate', async (req, res, next) => {
  
  try {
    const thisUser = _getUserFromRequest(req);

    if (!req.files || !req.files.file) throw new Error('No file uploaded');

    const uploadedFile = req.files.file; // file=what we define in react

    const { fromLanguage, toLanguage } = req.body;

    const newFilename = await _constructNewFilename(thisUser, uploadedFile.name, toLanguage);

    const translationResultArray = await msTranslation.translate(uploadedFile.data, fromLanguage, toLanguage);

    const buf = _createBufferFromTextArray(translationResultArray.textArray);

    const thisFile = {
      data: buf,
      content_type: 'text/plain',
      file_name: newFilename,
      lang_from: fromLanguage,
      lang_to: toLanguage,
      char_length: translationResultArray.totalCharLength
    };

    const savedUser = await _saveFileAndRetrieveUserInfo(thisUser, thisFile);

    const translatedFiles = _getTranslatedFiles(savedUser.user_files);

    return res.json({ translatedFiles });
  } catch (err) {
    res.status(500).json({ err });
    next(err);
  }
});

/**
 * @DELETE /api/translate/documents/delete
 * 
 */
router.delete('/delete', async (req, res, next) => {
  const tobeDeletedFileIds = req.body.translatedFiles;
  if (!tobeDeletedFileIds || tobeDeletedFileIds.length === 0)
    return res.status(400).json({ err: 'no files to be deleted' });

  try {
    const thisUser = _getUserFromRequest(req);
    const userFound = await _deleteFilesAndRetrieveUserInfo(thisUser, tobeDeletedFileIds);
    const translatedFiles = _getTranslatedFiles(userFound.user_files);

    return res.json({ msg: 'files deleted', translatedFiles });
  } catch (err) {
    res.status(500).json({ err });
    next(err);
  }
});

/**
 * @POST /api/translate/documents/download
 * 
 */
router.post('/download', async (req, res, next) => {
  const tobeDownloadedFileIds = req.body.translatedFiles;
  if (!tobeDownloadedFileIds || tobeDownloadedFileIds.length === 0)
    return res.status(400).json({ err: 'no file to be downloaded' });

  const nickname = req.body.nickname;
  if (!nickname)
    return res.status(400).json({ err: 'no nickname sent' });

  try {
    if (tobeDownloadedFileIds.length === 1) {
      const fileId = tobeDownloadedFileIds[0].id;
      const file = await Userfiles.findById(fileId);
      const fileData = file.data;

      // download 1 file 
      res.set({
        'Content-Type': 'text/plain',
        'Content-Disposition': `attachment;filename=${file.file_name}`,
      });
      return res.send(Buffer.from(fileData, 'binary'));
    } else {
      // zip multiple file
      const zip = new JSZip();
      const dataFolder = zip.folder('translatedfiles');

      for (let i = 0; i < tobeDownloadedFileIds.length; i++) {
        const fileId = tobeDownloadedFileIds[i].id;
        const file = await Userfiles.findById(fileId);
        const fileData = file.data;
        dataFolder.file(`${file.file_name}`, fileData);
      }

      const date = new Date();
      const formattedDate = date.toLocaleDateString().replace(/\//g, '-');
      const zipFilename = `${nickname}_translation_${formattedDate}`;

      zip.generateAsync({ type: 'nodebuffer' })
        .then((content) => {
          res.set({
            'Content-Type': 'text/plain',
            'Content-Disposition': `attachment;filename=${zipFilename}.zip`,
          });
          return res.send(Buffer.from(content, 'binary'));
        });
    }

  } catch (err) {
    res.status(500).json({ err });
    next(err);
  }
});

const _deleteFilesAndRetrieveUserInfo = async (inputUser, tobeDeletedFileIds) => {
  for (let i = 0; i < tobeDeletedFileIds.length; i++) {
    // remove the file reference on the user record
    await Users.updateOne(
      {},
      {
        $pull: {
          user_files: new ObjectId(tobeDeletedFileIds[i].id)
        }
      }
    );
    // delete the file from userfiles table
    await Userfiles.deleteOne({ _id: tobeDeletedFileIds[i].id });
  }

  // get latest data from user
  const userFound = await _findUserAndPopulateFiles(inputUser);
  if (!userFound || !userFound._id) throw new Error({ message: 'User not found in the database' });

  return userFound;
}

const _saveUser = async (inputUser) => {
  const newUser = new Users(inputUser);
  const savedUser = await newUser.save({});
  return savedUser;
}

const _saveFileAndRetrieveUserInfo = async (inputUser, inputFile) => {

  const userFound = await _findUserAndPopulateFiles(inputUser);
  if (!userFound || !userFound._id) throw new Error({ message: 'User not found in the database' });

  const fileSaved = await _saveFile(userFound._id, inputFile);

  // push file reference to user record
  userFound.user_files.push(fileSaved);

  // save the user record
  const userResult = await userFound.save({});

  return userResult;

}

const _constructNewFilename = async (inputUser, oldName, toLang) => {

  const nameArray = oldName.split('.');
  const ext = nameArray.pop();
  const name = nameArray.join('.') + '_' + toLang;

  const newFilenameNoExt = await _getNewFilenameNoExt(inputUser, name);

  return (newFilenameNoExt + '.' + ext);
}

/** 
 * @param filename
 * format: <filename>_<toLanguage>
 * example: airbnbGuide_it
*/
const _getNewFilenameNoExt = async (inputUser, filename) => {

  const user = await Users.findOne(inputUser);
  if (!user || !user._id) throw new Error('User not found in the database');

  // find duplicate filename
  const fileFound = await Userfiles
    .findOne({ file_owner: user._id, file_name: { $regex: '.*' + filename + '.*' } })
    .sort({ create_date: 'desc' });

  if (_isFileFound(fileFound)) {
    // remove extension
    const filenameArr = fileFound.file_name.split('.');
    filenameArr[filenameArr.length - 1] = null;
    filenameArr.pop();

    // remove prefix
    const tail = filenameArr.join('.').replace(filename, '');

    if (!tail) {
      return (filename + '_2');
    } else {
      // remove underscore
      const numberStr = tail.substring(1);
      // increment the number
      const newNumber = parseInt(numberStr) + 1;
      return (filename + '_' + newNumber);
    }
  }

  return filename;
}

const _findUserAndPopulateFiles = async (inputUser) => {
  const user = await Users.findOne(inputUser)
    .populate('user_files')
    .exec();
  return user;
}

const _saveFile = async (userId, inputFile) => {
  const newFile = new Userfiles({
    data: inputFile.data,
    content_type: inputFile.content_type,
    file_name: inputFile.file_name,
    lang_from: inputFile.lang_from,
    lang_to: inputFile.lang_to,
    char_length: inputFile.char_length,
    file_owner: userId
  });

  const savedFile = await newFile.save({});
  return savedFile;
}

const _getTranslatedFiles = userFiles => {
  const translatedFiles = [];

  if (_isFileFound(userFiles)) {
    userFiles.forEach(element => {
      let newObj = {
        id: element._id,
        name: element.file_name,
        fromLanguage: element.lang_from,
        toLanguage: element.lang_to
      };
      translatedFiles.push(newObj);
    });
  }

  return translatedFiles;
}

const _getUserFromRequest = req => {
  let errMessage = '';
  if (!req.body.email) errMessage += 'User email';
  if (!req.body.authentication) errMessage += errMessage ? ' and authentication' : 'User authentication';
  if (errMessage) {
    errMessage += ' not found';
    throw new Error({ message: errMessage });
  }

  return {
    email: req.body.email,
    authentication: req.body.authentication
  };
}

const _isFileFound = files => {
  if (Array.isArray(files)) {
    return (files.length > 0);
  }
  return (files && files.file_name !== '');
}

/**
 * @function _createBufferFromTextArray
 * @description create a buffer from an array of string
 * @param {Array.<string>} textArray - an array of string
 * @returns {Buffer} data with the type of Buffer
 */
const _createBufferFromTextArray = textArray => {
  let str = '';
  for (let i = 0; i < textArray.length; i++) {
    const data = textArray[i];
    if (!data || i === textArray.length - 1) {
      str += '\n';
    } else {
      str += data;
    }
  }
  return Buffer.from(str);
}

/**
 * @POST /api/translate/documents/save_test
 * 
 */
router.post('/save_test', async (req, res, next) => {
  try {
    const thisUser = _getUserFromRequest(req);

    if (!req.files || !req.files.file) throw new Error('No file uploaded');

    const uploadedFile = req.files.file; // file=what we define in react

    const { fromLanguage, toLanguage } = req.body;

    const newFilename = await _constructNewFilename(thisUser, uploadedFile.name, toLanguage);

    // do word count and construct array
    const translationResultArray = msTranslation.constructRequestDataFromBuffer(uploadedFile.data);

    const buf = _createBufferFromTextArray(translationResultArray.textArray);

    const thisFile = {
      data: buf,
      content_type: 'text/plain',
      file_name: newFilename,
      lang_from: fromLanguage,
      lang_to: toLanguage,
      char_length: translationResultArray.totalCharLength
    };

    const savedUser = await _saveFileAndRetrieveUserInfo(thisUser, thisFile);

    const translatedFiles = _getTranslatedFiles(savedUser.user_files);

    await new Promise((resolve, reject) => {
      setTimeout(() => {
        console.log('wait!');
        resolve();
      }, 5000);
    });

    console.log('return');

    res.json({ translatedFiles });

  } catch (err) {
    console.error(err);
    res.json({ err: 'something went wrong' });
  }
});

/**
 * @POST /translate_test
 * read a local file
 * call third party api
 * write into a newfile
 */
router.post('/translate_test', async (req, res, next) => {
  try {

    // read the file from local directory
    const readfileResult = await msTranslation.readPlainTextFile('../test_file', 'a_spanish_text.txt');

    const result = await msTranslation.translate(readfileResult, req.body.fromLanguage, req.body.toLanguage);

    // write the file to local directory
    await msTranslation.writeFile('../test_file', 'newfile.txt', result.textArray);

    res.json({ totalCharLength: result.totalCharLength });

  } catch (err) {
    console.error(err);
    res.json({ err: 'something went wrong' });
  }

});

module.exports = router;