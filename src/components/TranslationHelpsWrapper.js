import React, { useState, useEffect } from 'react';

function TranslationHelpsWrapper() {
  const [greeting, setGreeting] = useState('hello');

  useEffect(() => {
    setGreeting('hello2');
  }, [greeting]);

  return <div onClick={() => setGreeting('Hey')}>
    <span>{greeting} world!</span>
  </div>;
}

export default TranslationHelpsWrapper;
