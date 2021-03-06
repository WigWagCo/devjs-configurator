'use strict'
/*
 * Copyright (c) 2018, Arm Limited and affiliates.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


const request = require('request')
const path = require('path')
const fs = require('fs')
const common = require('./common-funcs')
const util = require('util');

const CONFIGURATOR_DEFAULT_PORT = 45367


var do_fs_jsononly = function(filepath) {
    var json = null;
    try {
        json = fs.readFileSync(filepath, 'utf8');
    } catch(e) {
        common.log_warn("Error reading:",filepath);
        common.log_warn("  Details: " + util.inspect(e));
        return null;
    }
    if(json && typeof json == 'string') {
        return JSON.parse(json);
    } else {
        common.log_err("Failed to parse JSON for",filepath,e);
        return null;
    }
};

/**
 *
 * @param moduleName* {string} If not provided, will be found by taking 'name' from devicejs.json
 * @param moduleLocalDirectory {string} The local directory of the module where a config.json file should be sitting
 * @param moduleLocalConfigFileName {string} defaults to 'config.json'
 * @returns {{then: Function}}
 */
var configurator = function(port) {
    if(!port) {
        port = CONFIGURATOR_DEFAULT_PORT
    }
    
    return {
        configure: function(moduleName, moduleLocalDirectory, moduleLocalConfigFileName) {
            if(arguments.length < 2) {
                moduleLocalDirectory = moduleName;
                moduleName = undefined;
            }

            if(!moduleLocalConfigFileName) {
                moduleLocalConfigFileName = 'config.json'
            }

            common.log_info("devjs-configurator (maestro variation) .configure()...",moduleName,moduleLocalDirectory,moduleLocalConfigFileName);
            
            if(!moduleName) {
                common.log_info("Looking at devicejs.json")
                // get modName via devicejs.json
                var _path = path.join(moduleLocalDirectory,"devicejs.json");
                var obj = do_fs_jsononly(_path);
                if(!obj || !obj.name) {
                    return Promise.reject("Could not gather module name from devicejs.json ("+_path+")");
                } else {
                    moduleName = obj.name;
                    common.log_info("moduleName is '"+moduleName+"'");
                }
            }
            var conf_name = "default";
            if(global.MAESTRO_CONFIG_NAMES && global.MAESTRO_CONFIG_NAMES[moduleName]) {
                conf_name = global.MAESTRO_CONFIG_NAMES[moduleName];
            } else {
                common.log_info("No config name provided for",moduleName,"so using '"+conf_name+"'");
            }

            return new Promise(function(resolve, reject) {
            // How to sniff Unix socket:
            // socat -t100 -v UNIX-LISTEN:/tmp/maestroapi2.sock,mode=777,reuseaddr,fork UNIX-CONNECT:/tmp/maestroapi.sock
            // make /tmp/maestroapi2.sock go to /tmp/maestroapi.sock - but dump all output which comes through
		
                if (global.MAESTRO_UNIX_SOCKET) {
//		    MAESTRO_UNIX_SOCKET = '/tmp/maestroapi2.sock'; // HACK - test - remove me
                    var localUrl = 'http://unix:' + MAESTRO_UNIX_SOCKET + ':/jobConfig/' + moduleName + '/' + conf_name;

                    common.log_info("Using get config URL:",localUrl);

                    request.get({
                        url: localUrl,
                        json: true,
                        headers: {
                            "Host":"127.0.0.1",
                            "Accept":"application/json",
                            "Connection":"close"
                        }
                    }, function(error, response, body) {
                        if(error) {
                            console.log("devjs-configurator - looks like no response from maestro. Doing fallback.",error);
                            resolve(null); // move along to file method
                        }
                        else if(response.statusCode != 200) {			    
                            console.error("Bad response. maybe problem with maestro or path?",response.statusCode,"path was:",localUrl);
                            resolve(null); // move along to file method
                        }
                        else {
			    // Direct response from API is this:
			    // { configs:
			    //   [ { name: 'default',
			    // 	  job: 'maestro-runner-testmodule',
			    // 	  data: '{ "specialsauce" : "chipotle mayonnaise" }   \n',
			    // 	  encoding: 'utf8',
			    // 	  files: null,
			    // 	  mod_time: '' } ] }
			    if(typeof body === 'object' && body.configs && util.isArray(body.configs) && body.configs.length > 0
			       && typeof body.configs[0].data === 'string') {
				common.minifyJSONParseAndSubstVars(body.configs[0].data,function(err,data){
                                    if(err){
					common.log_err('devjs-configurator: Error parsing config .data JSON for module ' + moduleName + ': ' + util.inspect(err))
					resolve(null);
//					reject(new Error("Error reading config file: "+util.inspect(err)));
                                    } else {
					resolve(data);
                                    }
				},{
                                    thisdir: moduleLocalDirectory
				});				
			    } else {
				console.error("devjs-configurator got response for",moduleName,":",conf_name," but is not properly formed:",body);
				resolve(body);
			    }
                        }
                    })

                } else {
                    common.log_warn("No MAESTRO_UNIX_SOCKET defined - not ran with maestroRunner or problem with config.")
                    resolve(null)
                }
            }).then(function(configuration) {
                if(configuration != null) {
                    return configuration;
                }
                var fpath = path.resolve(moduleLocalDirectory, moduleLocalConfigFileName)
                common.log_warn('devjs-configurator: Unable to retrieve config from server for module ' + moduleName + '. Trying to read config from ' + fpath);
                
                // try to read from file
                return new Promise(function(resolve, reject) {
                    fs.readFile(fpath, 'utf8', function(error, json) {
                        if(error) {
                            common.log_err('devjs-configurator: Unable to load configuration from file for module ' + moduleName + ': ' + util.inspect(error))
                            reject(new Error('Unable to load configuration: ' + error.message))
                        } else {
                            common.minifyJSONParseAndSubstVars(json,function(err,data){
                                if(err){
                                    common.log_err('devjs-configurator: Error parsing config file ['+fpath+'] for module ' + moduleName + ': ' + util.inspect(err))
                                    reject(new Error("Error reading config file: "+util.inspect(err)));
                                } else {
                                    resolve(data);
                                }
                            },{
                                thisdir: moduleLocalDirectory
                            });
                        }
                    })
                })
            })

        },

        setModuleConfig: function(moduleName, configuration) {
            return new Promise(function(resolve, reject) {
                var conf_name = 'default';
                if (global.MAESTRO_UNIX_SOCKET) {
                    var localUrl = 'http://unix:' + MAESTRO_UNIX_SOCKET + ':/jobConfig/' + moduleName + '/' + conf_name;

        		    var configwrapper = {
                        name: conf_name,
                        job: moduleName,
                        data: JSON.stringify(configuration),
                        encoding: 'utf8'
                    };
  
                    request.post({
                        url: localUrl,
                        body: configwrapper,
                        json: true,
                        headers: {
                            "Host":"127.0.0.1",
                            "Accept":"application/json"
                            // "Connection":"close"
                        }
                    }, function(error, response, body) {
                        if(error) {
                            common.log_err('devjs-configurator: Unable to set configuration for module ' + moduleName + ': ' + error.message)
                            
                            reject(error)
                        }
                        else if(response.statusCode != 201 && response.statusCode != 202) {
                            common.log_err('devjs-configurator: Unable to set configuration for module ' + moduleName + ': HTTP response is ' + response.statusCode)                        
                            reject(new Error('HTTP error '+ response.statusCode))
                        }
                        else {
                            resolve()
                        }
                    })
                } else {
                    console.error("No MAESTRO_UNIX_SOCKET defined - can't setModuleConfig.")
                    resolve(null)                    
                }
            })
        }

        // Server component in [github]/armPelionEdge/devjs-configurator-server
    }
};

module.exports = new configurator();
module.exports.instance = configurator;
module.exports.minifyJSONParseAndSubstVars = common.minifyJSONParseAndSubstVars;
module.exports.minifyJSONParse = common.minifyJSONParse;
module.exports.resolveVarsPath = common.resolveVarsPath;
module.exports.JSONminify = require('./lib/minify.json.js');
module.exports.DEFAULTS = {
    port: CONFIGURATOR_DEFAULT_PORT
};
