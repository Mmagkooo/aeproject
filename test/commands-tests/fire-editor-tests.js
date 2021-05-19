const chai = require('chai');
let chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
const assert = chai.assert;
const util = require('util');
const pureExec = require('child_process').exec;
const exec = util.promisify(pureExec);
const constants = require('../constants.json');
const cliCmds = constants.cliCommands;
const cliCmdOptions = constants.cliCommandsOptions;

const fireEditorConstants = require('./../../packages/aeproject-cli/aeproject-fire-editor/constants.json');

const fireEditorInfoMessages = fireEditorConstants.MESSAGES;
const fireEditorName = fireEditorConstants.MODULE_NAME;
const fireEditorNodeVersion = fireEditorConstants.FIRE_EDITOR_NODE_VERSION;

const isNodeVersionSupported = require('./../../packages/aeproject-cli/aeproject-fire-editor/fire-editor').isNodeVersionSupported;
const maxSecondsToWaitProcess = 1000 * 60 * 10; // minutes

const cwd = process.cwd();

xdescribe('AEproject Fire Editor', () => {

    before(async function () {
        // uninstall globally fire-editor
        await exec(`npm uninstall -g ${ fireEditorName }`);
    });

    it('should fail if node version is less than the required', () => {
        let nodeVersion = "9.5.0";
        let result = isNodeVersionSupported(fireEditorNodeVersion, nodeVersion)

        assert.equal(result, false);
    })

    it('should pass if node version is equal than the required', () => {
        let nodeVersion = "10.9.0";
        let result = isNodeVersionSupported(fireEditorNodeVersion, nodeVersion)

        assert.equal(result, true);
    })

    it('should pass if node version is greater than the required', () => {
        let nodeVersion = "12.1.0";
        let result = isNodeVersionSupported(fireEditorNodeVersion, nodeVersion)

        assert.equal(result, true);
    })

    it('should install Fire Editor globally and run it', async function () {
        let promise = () => {
            return new Promise(function (resolve, reject) {
                let childProcess = pureExec(`aeproject ${ cliCmds.FIRE_EDITOR } ${ cliCmdOptions.IGNORE_OPENING }`)

                // if process stuck or something went wrong, this timeout will kill current command/process
                let timeout = setTimeout(function () {
                    pureExec(`kill -9 ${ childProcess.pid }`);
                    resolve(false);
                }, maxSecondsToWaitProcess);

                childProcess.stdout.on('data', data => {
                    // console.log(data.toString('utf8'));

                    if (data.indexOf('open your browser on') >= 0) {
                        // kill -9 pId
                        pureExec(`kill -9 ${ childProcess.pid }`);
                        clearTimeout(timeout);
                        resolve(true)
                    }
                });

                childProcess.stderr.on('data', data => {
                    // console.log(data.toString('utf8'));
                    reject(data);
                });
            })
        }

        let result = await promise();

        assert.isOk(result, "Cannot install or run Fire Editor. Takes too much time");
    });

    it('should execute fire-editor cli command with update parameter correctly', async function () {
        let promise = () => {
            return new Promise(function (resolve, reject) {
                let childProcess = pureExec(`aeproject ${ cliCmds.FIRE_EDITOR } ${ cliCmdOptions.UPDATE } ${ cliCmdOptions.IGNORE_OPENING }`)

                // if process stuck or something went wrong, this timeout will kill current command/process
                let timeout = setTimeout(function () {
                    pureExec(`kill -9 ${ childProcess.pid }`);
                    resolve(false);
                }, maxSecondsToWaitProcess);

                childProcess.stdout.on('data', data => {
                    // console.log('-->>', data);
                    
                    if (data && data.toLowerCase().indexOf(fireEditorInfoMessages.SUCCESSFUL_UPDATE.toLowerCase()) >= 0) {
                        // kill -9 pId
                        pureExec(`kill -9 ${ childProcess.pid }`);
                        clearTimeout(timeout);
                        resolve(true)
                    }
                });

                childProcess.stderr.on('data', data => {
                    // console.log('err', data);
                    reject(data);
                });
            })
        }

        let result = await promise();
        assert.isOk(result, "Cannot update Fire Editor or takes too much time")
    });

    after(async function () {
        process.chdir(cwd);
        await exec(`npm uninstall -g ${ fireEditorName }`);
    })
});