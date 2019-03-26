export { default as Api } from './Api';
export { default as ToolWrapper } from './ToolWrapper';
// export { default as reducers } from './reducers';

import {connectTool} from 'tc-tool';
// import path from 'path';

export default connectTool('translationWords', {
  // localeDir: path.join(__dirname, './src/locale'),
  api: new Api()
})(ToolWrapper);
