export default (state = { init: 'hello world' }, action) => {
  switch (action.type) {
  case 'HELLO':
    return {};
  default:
    return state;
  }
};
