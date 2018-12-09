// @ts-check

'use strict';

const fs = require('fs');
const path = require('path');
const webpack = require('webpack');
const CleanPlugin = require('clean-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const FileManagerPlugin = require('filemanager-webpack-plugin');

// @ts-ignore
const pkg = require('./package.json');

module.exports = function(env, argv) {
  env = env || {};
  env.production = Boolean(env.production);
  env.copyClipboardyFallbacks =
    env.production || Boolean(env.copyClipboardyFallbacks);

  if (
    !env.copyClipboardyFallbacks &&
    !fs.existsSync(path.resolve(__dirname, 'fallbacks'))
  ) {
    env.copyClipboardyFallbacks = true;
  }

  return [getExtensionConfig(env)];
};

function getExtensionConfig(env) {
  const clean = ['dist'];
  if (env.copyClipboardyFallbacks) {
    clean.push('fallbacks');
  }

  const plugins = [
    new CleanPlugin(clean, { verbose: false }),
    new webpack.IgnorePlugin(/^spawn-sync$/),
    new webpack.DefinePlugin({
      PRODUCTION: JSON.stringify(env.production),
      EXTENSION_VERSION: JSON.stringify(pkg.version)
    })
  ];

  if (env.copyClipboardyFallbacks) {
    plugins.push(
      // @ts-ignore
      new FileManagerPlugin({
        onEnd: [
          {
            copy: [
              {
                source: path.resolve(
                  __dirname,
                  'node_modules/clipboardy/fallbacks'
                ),
                destination: 'fallbacks/'
              }
            ]
          }
        ]
      })
    );
  }

  return {
    name: 'extension',
    entry: './src/extension.ts',
    mode: env.production ? 'production' : 'development',
    target: 'node',
    node: {
      __dirname: false
    },
    devtool: 'source-map',
    output: {
      libraryTarget: 'commonjs2',
      filename: 'extension.js',
      devtoolModuleFilenameTemplate: 'file:///[absolute-resource-path]'
    },
    optimization: {
      minimizer: [
        new TerserPlugin({
          cache: true,
          parallel: true,
          sourceMap: true,
          terserOptions: {
            ecma: 8,
            module: true
          }
        })
      ]
    },
    externals: {
      vscode: 'commonjs vscode'
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          enforce: 'pre',
          use: 'tslint-loader',
          exclude: /node_modules/
        },
        {
          test: /\.tsx?$/,
          use: 'ts-loader',
          exclude: /node_modules|\.d\.ts$/
        }
      ]
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx']
    },
    plugins: plugins,
    stats: {
      all: false,
      assets: true,
      builtAt: true,
      env: true,
      errors: true,
      timings: true,
      warnings: true
    }
  };
}
