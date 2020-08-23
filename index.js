'use strict';

const AWS = require('aws-sdk');
const http = require('https');
const fs = require('fs');
const util = require('util');
const execSync = require('child_process').execSync;
const AdmZip = require('adm-zip');
const rimraf = require('rimraf-promise');
const lambda = new AWS.Lambda();
process.env.PATH = `${process.env.PATH}:/opt/bin`;
module.exports.handler = async (event, context) => {
  const awsInvocationId = context.awsRequestId;
  const zipFilename = `/tmp/${awsInvocationId}.zip`;
  const decompressedDirectory = `/tmp/${awsInvocationId}`;

  if (!event.queryStringParameters || !event.queryStringParameters.arn) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: 'arn querystring parameter is required'
      })
    };
  }
  const params = { Arn: event.queryStringParameters.arn };

  try {
    const result = await lambda.getLayerVersionByArn(params).promise();
    console.log('getLayerVersionByArn', result);

    return new Promise((resolve,reject) => {
      http.get(result.Content.Location, res => {
        res.on('end', async () => {
          console.log('finished downloading file');
          const zip = new AdmZip(zipFilename);
          zip.extractAllTo(decompressedDirectory, false);

          const lsOutput = execSync(`find ${decompressedDirectory} -type f -exec ls -la --time-style=long-iso {} \\;`, { encoding: 'utf8' });
          console.log('ls output', lsOutput);

          await Promise.all([
            rimraf(zipFilename),
            rimraf(decompressedDirectory)
          ]);
          console.log('deleted files');

          return resolve({
            statusCode: 200,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Credentials': true
            },
            body: JSON.stringify({
              url: result.Content.Location,
              files: lsOutput.trim().split('\n').map(line => {
                const withoutDuplicateSpaces = formatLine(line);
                const parts = withoutDuplicateSpaces.split(' ');
                return [parts[7].replace(`${decompressedDirectory}/`, ''), parts[4], `${parts[5]} ${parts[6]}`, parts[0]]
              })
            })
          })
        });
        res.on('error', (err) => {
          console.log('error http.get', err);
          return reject(err);
        })
        res.pipe(fs.createWriteStream(zipFilename));
      });

    });
  } catch(err) {
    if(err.errorType === 'AccessDeniedException' || err.code === 'AccessDeniedException') {
      return formatResponse(400, {
        error: 400,
        message: `Seems like the ARN it's not publicly accesible`
      });
    }

    if(err.code === 'ResourceNotFoundException') {
      return formatResponse(400, {
        message: `This ARN doesn't exists`
      });
    }

    console.log('error', err);

    return formatResponse(500, {
      message: 'Ouch, something went wrong :/'
    })
  }
}

function formatResponse(statusCode, body) {
  if(statusCode !== 200) {
    body.error = statusCode;
  }
  return {
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Credentials': true
    },
    body: JSON.stringify(body)
  };
}

function formatLine(str) {
  return str.replace(/\s\s+/g, ' ');
}