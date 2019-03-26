import {connectTool} from 'tc-tool';
import path from 'path';
import Api from './Api';
import ToolWrapper from './ToolWrapper';
// export { default as reducers } from './reducers';


export default connectTool('translationWords', {
  localeDir: path.join(__dirname, './src/locale'),
  api: new Api()
})(ToolWrapper);
