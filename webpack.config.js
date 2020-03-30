const path = require('path');

module.exports = {
  mode: 'none',
  entry: './src/index.js',
  target: 'node',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',
    libraryTarget: 'commonjs2',
  },
  devtool: 'source-map',
  module: {
    rules: [
      {
        test: /\.js$/,
        include: path.resolve(__dirname, 'src'),
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: { babelrc: true },
        },
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.(jpg|png|svg)$/,
        loader: 'file-loader',
        options: { name: '[path][name].[hash].[ext]' },
      },
    ],
  },
  node: { __dirname: true },
  externals: {
    'react': 'commonjs react',
    'react-redux': 'react-redux',
    'tc-ui-toolkit': 'tc-ui-toolkit'
  },
  resolve: { alias: { 'react-redux': path.resolve('./node_modules/react-redux') } },
};
