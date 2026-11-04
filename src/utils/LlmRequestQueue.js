import delay from './delay';
import {
  getBestSelections,
  redactOptions,
} from './autoCheckingUtils';

/**
 * A queue for managing AI-powered translation suggestion requests with pause/resume support.
 *
 * This class orchestrates the processing of AI-generated translation suggestion requests in the
 * tCore checking workflow. It manages request queuing, processing state, and provides mechanisms
 * for pausing request processing when needed (e.g., during configuration changes).
 *
 * **Architecture:**
 * - **Composition**: Uses a {@link RequestQueue} instance for actual queue management
 * - **State machine**: Maintains `busy` (processing) and `pause` (suspended) flags
 * - **Async processing**: Handles asynchronous AI requests with automatic retry/resume
 * - **Callback pattern**: Executes callbacks when results are ready, supporting event-driven workflows
 *
 * **Processing Flow:**
 * 1. Requests are added via `makeSuggestionRequest()` (standard or priority)
 * 2. After a 100ms delay, `processNextRequest()` is called automatically
 * 3. If not busy/paused, the next request is retrieved and the busy flag is set
 * 4. The request is processed by calling `getBestSelections()` (AI or algorithmic)
 * 5. When complete, the callback is invoked with results
 * 6. After another 100ms delay, busy flag clears and next request is processed
 *
 * **Pause Mechanism:**
 * The `requestPause()` method allows external code to temporarily suspend request processing:
 * - Sets the pause flag to block new processing
 * - Waits for any in-progress request to complete (polls busy flag)
 * - Executes the provided callback while processing is guaranteed paused
 * - Resumes processing automatically after callback completes
 *
 * **Use Cases:**
 * - **Configuration updates**: Pause queue to change AI model or server settings
 * - **Resource management**: Pause during high system load
 * - **Batch operations**: Pause to perform bulk data updates
 * - **Error recovery**: Pause to reset connection state after failures
 *
 * @example
 * // Basic request processing
 * const queue = new LlmRequestQueue();
 *
 * const request = {
 *   verseText: 'para la iglesia de Éfeso',
 *   alignedGLText: 'church',
 *   targetLanguageDetails: { id: 'es-419' },
 *   gatewayLanguageCode: 'en',
 *   selectionsData: { selections: {...} },
 *   llmQueryUrl: 'http://localhost:1234',
 *   currentModel: 'my-model',
 *   llmTemperature: 0.7
 * };
 *
 * queue.makeSuggestionRequest(request, (results) => {
 *   if (!results.error) {
 *     console.log('Suggestions:', results.bestSelections);
 *   }
 * });
 *
 * @example
 * // Priority request (jumps queue)
 * queue.makeSuggestionRequest(urgentRequest, urgentCallback, true);
 *
 * @example
 * // Pausing to change configuration
 * await queue.requestPause(async () => {
 *   // Queue is guaranteed paused here
 *   await updateAIServerSettings();
 *   console.log('Configuration updated');
 * });
 * // Queue automatically resumes after callback
 *
 * @example
 * // Complete workflow with error handling
 * const queue = new LlmRequestQueue();
 *
 * function processTranslation(phrase) {
 *   const request = buildRequestData(phrase);
 *
 *   queue.makeSuggestionRequest(request, (results) => {
 *     if (results.error) {
 *       console.error('Translation failed:', phrase);
 *       retryOrFallback(phrase);
 *     } else {
 *       displaySuggestions(results.bestSelections);
 *       updateMetrics(results.elapsedStr, results.model);
 *     }
 *   });
 * }
 *
 * // Process multiple phrases
 * phrases.forEach(processTranslation);
 *
 * @see {@link RequestQueue} - Underlying queue implementation for managing requests
 * @see {@link getBestSelections} - Main function that processes each queued request
 * @see {@link delay} - Utility function for async timing control between processing steps
 */
export class LlmRequestQueue {
  /**
   * Constructs and initializes a new LLM request queue manager.
   *
   * This constructor creates a new instance of the request queue system for managing
   * AI-powered translation suggestion requests. It initializes the internal state needed
   * for request processing and pause/resume functionality.
   *
   * **Initialized State:**
   * - `requestQueue`: A new {@link RequestQueue} instance for managing the FIFO/priority queue
   * - `busy`: Boolean flag set to `false`, indicating no request is currently being processed
   * - `pause`: Boolean flag set to `false`, indicating request processing is not suspended
   *
   * **Usage:**
   * This constructor is called when creating a new queue manager instance to handle
   * translation suggestion workflows in the tCore checking tool.
   *
   * @constructor
   * @param {object} [suggestionsCache] - Cache memory object for suggestions
   * @returns {void} - Does not return a value; initializes instance state
   * @example
   * // Create a new queue manager for handling AI translation requests
   * const llmQueue = new LlmRequestQueue();
   *
   * // Queue is now ready to accept requests
   * llmQueue.makeSuggestionRequest(requestData, callback);
   *
   * @see {@link RequestQueue} - The underlying queue data structure class
   * @see {@link makeSuggestionRequest} - Primary method for adding requests to this queue
   * @see {@link processNextRequest} - Internal method that processes queued requests
   * @see {@link requestPause} - Method for temporarily suspending request processing
   */
  constructor(suggestionsCache) {
    this.requestQueue = new RequestQueue();
    this.busy = false;
    this.pause = false;
    this.suggestionsCache = suggestionsCache;
  }

  /**
   * Temporarily pauses request processing and executes a callback while paused.
   *
   * This method provides a safe way to suspend request processing to perform operations
   * that require the queue to be idle (e.g., changing AI server configuration, updating
   * models, or performing maintenance tasks).
   *
   * **Pause Mechanism:**
   * 1. Sets the `pause` flag to prevent new requests from being processed
   * 2. Polls the `busy` flag every 100ms until any in-progress request completes
   * 3. Executes the provided async callback once the queue is confirmed idle
   * 4. Clears the `pause` flag to resume normal processing
   * 5. Schedules `processNextRequest()` to handle any queued requests
   *
   * **Use Cases:**
   * - **Configuration changes**: Update AI model or server settings without race conditions
   * - **Resource management**: Pause during system maintenance or high load periods
   * - **Batch operations**: Perform bulk data updates while ensuring queue consistency
   * - **Error recovery**: Reset connection state or clear cached data after failures
   *
   * **Important Notes:**
   * - The callback is guaranteed to execute while no requests are being processed
   * - Request processing resumes automatically after the callback completes
   * - Any requests added during the pause will be processed once resumed
   * - The method is async and should be awaited to ensure pause/resume sequencing
   *
   * @async
   * @param {Function} asyncCallback - An async function to execute while processing is paused.
   *   The callback receives no arguments and its return value is ignored. Common operations
   *   include updating configuration, clearing caches, or resetting state.
   * @returns {Promise<void>} - Resolves when the pause cycle completes (callback finishes)
   */
  async requestPause(asyncCallback) {
    if (asyncCallback) {
      // let count = 0;
      // console.log(`requestPause`);
      this.pause = true; // pause processing

      while (this.busy) { // wait while busy
        // console.log(`requestPause - busy ${++count}`);
        // eslint-disable-next-line no-await-in-loop
        await delay(100);
      }

      // console.log(`requestPause - now ready`);
      await asyncCallback(); // let caller know they can call the API
      this.pause = false;

      delay(100).then(() => {
        // console.log(`requestPause - after delay calling processNextRequest`);
        this.processNextRequest();
      });
    }
  }

  /**
   * Searches the request queue for a request matching the specified key.
   *
   * This method iterates through the internal queue to find a request whose embedded key
   * property matches the provided search key. The key is typically constructed from context
   * information (e.g., book, chapter, verse, and gateway-language phrase) to uniquely identify
   * translation suggestion requests.
   *
   * @param {string} key - The unique identifier to search for in the queue
   * @returns {number} The zero-based index of the matching request in the queue, or -1 if not found
   */
  findKeyInQueue(key) {
    if (key) {
      for (let i = 0; i < this.requestQueue.queue.length; i++) {
        const item = this.requestQueue.queue[i];
        const itemRequests = Array.isArray(item?.request) ? item.request : [item?.request];

        if (itemRequests.some(itemRequest => itemRequest?.key === key)) {
          return i;
        }
      }
    }
    return -1;
  }

  /**
   * Removes a request from the queue by its key.
   *
   * Searches the queue for a request matching the provided key and removes it if found.
   * Uses findKeyInQueue to locate the request's position, then removes it from the queue
   * array using splice.
   *
   * @param {string} key - The unique identifier of the request to remove
   * @returns {boolean} - Returns true if request was found and removed, false otherwise
   */
  removeKeyInQueue(key) {
    const index = this.findKeyInQueue(key);

    if (index >= 0) {
      const item = this.requestQueue.queue[index];

      if (Array.isArray(item.request)) { // batched - drop just the matching request
        item.request = item.request.filter(itemRequest => itemRequest?.key !== key);
      }

      if (!Array.isArray(item.request) || !item.request.length) {
        this.requestQueue.queue.splice(index, 1);
      }
      return true;
    }
    return false;
  }

  /**
   * Queues a translation suggestion request and schedules processing. If cached suggestions
   * exist for the request's key and force is false, returns cached results immediately via callback.
   * Otherwise adds request to queue (front if priority is true, back if false) and triggers
   * processing after 100ms delay.
   *
   * @param {object|Array} request - Request data for translation suggestion
   * @param {Function} callback - Function called when results ready
   * @param {boolean} [priority=false] - If true, adds to front of queue
   * @param {boolean} [force=false] - If true, bypasses cache
   * @returns {void}
   */
  makeSuggestionRequest(request, callback, priority = false, force = false) {
    if (request) {
      const nonMemoryRequests = [];
      const requests = Array.isArray(request) ? request : [request];

      for (const _request of requests) {
        const memory = this.getSuggestionsMemoryForKey(_request.key);

        if (memory && !force) { // if we have a cached value, then use it
          // console.log(`makeSuggestionRequest found cached suggestion`);
          memory.cached = true;
          delay(1).then(() => {
            callback(memory);
          });
        } else {
          nonMemoryRequests.push(_request);
          this.removeKeyInQueue(_request.key); // remove previous matching queries
          // console.log(`makeSuggestionRequest adding to queue - `, redactOptions(_request));
        }
      }

      if (nonMemoryRequests?.length) {
        if (nonMemoryRequests?.length > 1) {
          const requestData = { request: nonMemoryRequests, callback };
          this.requestQueue.addRequest(requestData, priority);
        } else {
          const requestData = { request: nonMemoryRequests[0], callback };
          this.requestQueue.addRequest(requestData, priority);
        }
      }
    }

    this.processNextRequestIfNotBusy();
  }

  /**
   * Schedules processing of the next queued request if the queue is not currently busy or paused.
   *
   * After a 100ms delay, calls processNextRequest() to handle the next pending translation
   * suggestion request. This method is invoked after adding requests to the queue to trigger
   * processing without blocking the caller.
   */
  processNextRequestIfNotBusy() {
    if (!this.busy && !this.pause && this.requestQueue.hasRequests()) {
      delay(100).then(() => {
        // console.log(`processNextRequestIfNotBusy - after delay calling processNextRequest`);
        this.processNextRequest();
      });
    }
  }

  /**
   * Clears all pending requests from the queue.
   *
   * This method removes all queued translation suggestion requests by delegating to the
   * internal `RequestQueue.clearQueue()` method. It provides a clean interface for external
   * code to cancel all pending AI or algorithmic translation requests without affecting
   * any currently processing request.
   *
   * @returns {void} - Does not return a value; mutates the internal queue state
  */
  clearPendingRequests() {
    this.requestQueue.clearQueue();
  }

  /**
   * Processes the next request in the queue if not busy or paused.
   *
   * This internal method implements the core processing loop for the request queue. It
   * checks the queue state, retrieves the next pending request, processes it by calling
   * {@link getBestSelections}, invokes the result callback, and schedules itself to
   * process subsequent requests.
   *
   * **Processing State Machine:**
   * - **Idle state** (`!busy && !pause`): Ready to process next request
   *   - Retrieves next request from queue
   *   - Sets `busy=true` to prevent concurrent processing
   *   - Calls `getBestSelections()` with request data
   *   - Invokes callback with results
   *   - Sets `busy=false` and schedules next processing cycle
   * - **Busy state** (`busy=true`): Request currently being processed
   *   - Logs status and returns without action
   *   - Will be called again after current request completes
   * - **Paused state** (`pause=true`): Processing suspended
   *   - Logs status and returns without action
   *   - Resumes when `pause` flag is cleared by {@link requestPause}
   *
   * **Error Handling:**
   * - Catches exceptions during `getBestSelections()` call
   * - Converts errors to result object: `{ error: errorMessage.toString() }`
   * - Always invokes callback even on error to maintain flow
   * - Ensures `busy` flag is cleared even if processing fails
   *
   * **Processing Flow:**
   * 1. Check if queue is ready (not busy, not paused)
   * 2. Retrieve next request using `requestQueue.getNextRequest()`
   * 3. Set `busy=true` to block concurrent processing
   * 4. Call `getBestSelections()` with an options object built from the request:
   *    - `verseText`: Target-language verse text
   *    - `llmQueryUrl`: AI server URL or `null` for algorithmic mode
   *    - `targetLanguageDetails`: Language metadata
   *    - `alignedGLText`: Gateway-language phrase
   *    - `gatewayLanguageCode`: Gateway language code
   *    - `selectionsData`: Historical translation data
   *    - `currentModel`: AI model identifier
   *    - `llmTemperature`: AI temperature setting
   * 5. Await results (either AI or algorithmic suggestions)
   * 6. Invoke `callback(results)` to deliver results to requester
   * 7. After 100ms delay, set `busy=false` and call `processNextRequest()` again
   *
   * **Automatic Continuation:**
   * This method schedules itself recursively after each request completes, creating a
   * continuous processing loop that automatically handles all queued requests until the
   * queue is empty.
   *
   * @async
   * @returns {Promise<void>} - Resolves when processing cycle completes (or immediately
   *   if busy/paused)
   * @see {@link makeSuggestionRequest} - Public method that adds requests and schedules this method
   * @see {@link getBestSelections} - Core function that generates translation suggestions
   * @see {@link RequestQueue#getNextRequest} - Method used to retrieve next pending request
   * @see {@link requestPause} - Method that sets the pause flag to suspend processing
   * @see {@link delay} - Utility function used for scheduling continuation
   */
  async processNextRequest() {
    if (!this.busy && !this.pause && this.requestQueue.hasRequests()) {
      // console.log(`processNextRequest - not busy getting request`);
      const nextLlmRequest = this.requestQueue.getNextRequest();
      const requestData_ = nextLlmRequest?.request;
      const callback = nextLlmRequest?.callback;

      if (requestData_) {
        const results = await this.doQuery([], requestData_);

        for (let result of results) {
          const requestData = result?.request;
          let haveAsuggestion = this.testIfWeHaveASuggestion(result);

          if (!haveAsuggestion && requestData?.llmQueryUrl) { // if llm query failed, fall back to algorithmic suggestion
            const llmResults = result; // save llm results
            // console.log(`processNextRequest - empty suggestion, trying algorithm`);
            requestData.llmQueryUrl = '';
            // eslint-disable-next-line no-await-in-loop
            [result] = await this.doQuery([], requestData);
            result.llmError = llmResults?.error;
            result.algorithmFallback = true;
          }

          if (callback) {
            // console.log(`processNextRequest - doing callback`);

            try {
              // eslint-disable-next-line no-await-in-loop
              await callback(result);
            } catch (e) {
              console.error(`processNextRequest - callback ERROR`, e);
            }

            // eslint-disable-next-line no-await-in-loop
            await delay(10);

            // console.log(`processNextRequest - callback finished`);
          }

          if (haveAsuggestion) {
            // if we have at least one suggestion, save it
            this.saveSuggestionsMemoryForKey(requestData.key, result);
          }
        }

        this.busy = false;
        this.processNextRequestIfNotBusy();
      }
    } else {
      // console.log(`processNextRequest - not ready busy=${this.busy}, pause=${this.pause}`);
    }
  }

  /**
   * Validates whether a translation suggestion result contains at least one valid selection.
   *
   * This method examines a results object from either AI or algorithmic translation suggestion
   * processes to determine if it contains usable translation data. A suggestion is considered
   * valid when it contains at least one non-empty selection and no error flag is set.
   *
   * The validation checks two conditions:
   * 1. The results object must not have an error flag set
   * 2. The first (best) selection must contain at least one word selection
   *
   * @param {object} results - The results object from getBestSelections or related functions
   * @param {boolean} results.error - Error flag indicating if the query failed
   * @param {Array<{selections: Array<{text: string, occurrence: number}>, confidence: number}>} results.bestSelections -
   *   Array of translation options sorted by confidence, where each option contains:
   *   - selections: Array of {text, occurrence} objects representing matched words
   *   - confidence: Integer 0-100 indicating match certainty
   * @returns {boolean} Returns true if results contain at least one valid selection with no errors,
   *   false otherwise
   */
  testIfWeHaveASuggestion(results) {
    const _bestSuggestion = (results?.bestSelections?.length &&
      results?.bestSelections[0]) || { selections: [] };
    const haveSelections = _bestSuggestion?.selections?.length;
    const haveAsuggestion = !results.error && haveSelections;
    return haveAsuggestion;
  }

  /**
   * Processes a single translation suggestion request by querying the AI model or algorithmic fallback.
   *
   * This method executes the core translation suggestion logic by calling getBestSelections with the
   * request parameters. It handles both AI-powered and algorithmic suggestion modes based on the
   * llmQueryUrl parameter in the request data.
   *
   * The method manages the busy state by setting it to true before processing and relies on the
   * calling code to clear it after completion. It attaches the original request data to the results
   * for context tracking and error correlation.
   *
   * @param {Array<object>} results - Initial results object to populate, typically `{error: true}`
   * @param {object} requestData - Request parameters containing:
   *   - verseText: Target-language verse text
   *   - llmQueryUrl: AI server URL or null for algorithmic mode
   *   - targetLanguageDetails: Language metadata
   *   - alignedGLText: Gateway-language phrase
   *   - gatewayLanguageCode: Gateway language code
   *   - selectionsData: Historical translation data
   *   - currentModel: AI model identifier
   *   - llmTemperature: AI temperature setting
   * @returns {Promise<Array<object>>} Array of Results objects containing error status, best selections, elapsed time,
   *   model name, and the original request data. Returns `{error: errorMessage}` if an exception occurs
   */
  async doQuery(results, requestData) {
    try {
      this.busy = true;
      const _results = await getBestSelections(requestData);

      if (!Array.isArray(requestData)) {
        _results[0].request = redactOptions(requestData);
        results = _results;
      } else {
        for (let i = 0; i < _results.length; i++) {
          const result = _results[i];
          result.request = redactOptions(requestData[i]);
          results.push(result);
        }
      }
    } catch (e) {
      console.error(`processNextRequest - getBestSelections ERROR`, e);
      const requests = Array.isArray(requestData) ? requestData : [requestData];
      return requests.map(request => ({ error: e.toString(), request: redactOptions(request) }));
    }
    return results;
  }

  /**
   * Retrieves the suggestions cache memory object.
   *
   * @returns {object} The suggestions cache object containing cached translation suggestions
   */
  getSuggestionsMemory() {
    return this.suggestionsCache;
  }

  /**
   * Retrieves cached suggestion data for a specific key.
   *
   * @param {string} key - The unique identifier for the cached suggestion data
   * @returns {object|undefined} The cached suggestion data for the key, or undefined if not found
   */
  getSuggestionsMemoryForKey(key) {
    const cache = this.getSuggestionsMemory();
    return cache[key];
  }

  /**
   * Checks if cached suggestion data exists for the specified key.
   *
   * This method verifies whether translation suggestions have been previously cached
   * for a given gateway-language phrase/context combination. It is used to determine
   * if a new AI or algorithmic query is needed, or if cached results can be reused.
   *
   * **Use Cases:**
   * - **Performance optimization**: Avoid redundant AI queries by checking cache first
   * - **Instant feedback**: Return cached suggestions immediately without processing delay
   * - **Resource management**: Reduce load on AI server by serving cached results
   *
   * @param {string} key - The unique identifier for the cached suggestion data, typically
   *   constructed from context information (e.g., `{bookId}_{chapter}_{verse}_{glPhrase}`)
   * @returns {boolean} - `true` if cached suggestions exist for the key, `false` otherwise
   */
  alreadyHaveSuggestionsForKey(key) {
    const suggestions = this.getSuggestionsMemoryForKey(key);
    return !!suggestions;
  }

  /**
   * Saves suggestion data to the cache for a specific key.
   *
   * @param {string} key - The unique identifier for caching the suggestion data
   * @param {object} data - The suggestion data to cache, typically containing:
   *   - error: boolean indicating if an error occurred
   *   - bestSelections: array of translation suggestions
   *   - elapsedStr: string representation of processing time
   *   - model: model identifier used for the suggestion
   * @returns {void}
   */
  saveSuggestionsMemoryForKey(key, data) {
    const cache = this.getSuggestionsMemory();
    cache[key] = data;
  }
}

/**
 * A queue for managing AI-powered translation suggestion requests with priority support.
 *
 * This class implements a priority queue designed to manage requests for AI-generated
 * translation suggestions in the tCore checking workflow. It ensures orderly processing
 * of translation queries while preventing race conditions through a busy-flag mechanism.
 *
 * **Key Features:**
 * - **Priority handling**: High-priority requests (via `addPriorityRequest`) are placed
 *   at the front of the queue, while standard requests are appended to the back
 * - **Busy-flag locking**: Prevents concurrent processing of multiple requests through
 *   a simple busy state that must be manually cleared after each request completes
 * - **FIFO/LIFO hybrid**: Standard requests follow FIFO (first-in-first-out) ordering,
 *   but priority requests can "jump the line" using LIFO (last-in-first-out) insertion
 *
 * **Usage Pattern:**
 * 1. Add requests using `addRequest()` or `addPriorityRequest()`
 * 2. Retrieve next request with `getNextRequest()` (sets busy flag automatically)
 * 3. Process the request
 * 4. Call `clearBusy()` to allow next request to be retrieved
 * 5. Repeat steps 2-4 until queue is empty
 *
 * **Queue State:**
 * The queue maintains two pieces of state:
 * - `queue`: Array holding pending request objects in processing order
 * - `busy`: Boolean flag indicating whether a request is currently being processed
 *
 * **Typical Request Object Structure:**
 * Request objects are opaque to the queue and typically contain:
 * - `verseText`: Target-language verse text
 * - `alignedGLText`: Gateway-language phrase to translate
 * - `contextId`: Context information (book, chapter, verse, etc.)
 * - `selectionsData`: Historical translation data
 * - Other metadata needed for AI suggestion generation
 *
 * @example
 * // Basic usage with standard requests
 * const queue = new RequestQueue();
 *
 * queue.addRequest({ verseText: '...', alignedGLText: 'church' });
 * queue.addRequest({ verseText: '...', alignedGLText: 'elder' });
 *
 * const request = queue.getNextRequest();  // Returns first request, sets busy=true
 * // ... process request ...
 * queue.clearBusy();  // Ready for next request
 *
 * @example
 * // Priority request handling
 * const queue = new RequestQueue();
 *
 * queue.addRequest({ id: 1, type: 'normal' });
 * queue.addRequest({ id: 2, type: 'normal' });
 * queue.addPriorityRequest({ id: 3, type: 'urgent' });
 *
 * queue.getNextRequest();  // Returns { id: 3, type: 'urgent' } (priority)
 * queue.clearBusy();
 * queue.getNextRequest();  // Returns { id: 1, type: 'normal' } (FIFO order)
 *
 * @example
 * // Complete processing loop
 * const queue = new RequestQueue();
 *
 * // Populate queue
 * queue.addRequest({ phrase: 'church' });
 * queue.addRequest({ phrase: 'faith' });
 *
 * // Process all requests
 * while (queue.hasRequests()) {
 *   const request = queue.getNextRequest();
 *   if (request) {
 *     await processTranslationRequest(request);
 *     queue.clearBusy();
 *   }
 * }
 *
 * @example
 * // Queue state inspection
 * const queue = new RequestQueue();
 * queue.addRequest({ phrase: 'church' });
 * queue.addRequest({ phrase: 'elder' });
 *
 * console.log(queue.size());          // 2
 * console.log(queue.hasRequests());   // true
 * console.log(queue.isBusy());        // false
 *
 * const req = queue.getNextRequest();
 * console.log(queue.size());          // 1
 * console.log(queue.isBusy());        // true
 *
 * queue.clearQueue();
 * console.log(queue.size());          // 0
 * console.log(queue.hasRequests());   // false
 *
 * @see {@link getBestSelections} - Main consumer of queued translation requests
 * @see {@link getBestTWordSelectionWithConfidenceFromLlm} - AI function that processes requests
 * @see {@link getBestTWordSelectionWithConfidenceAlgorithm} - Non-AI function that processes requests
 */
export class RequestQueue {
  constructor() {
    this.queue = [];
  }

  /**
   * Adds a request to the queue.
   *
   * If `priority` is true, the request is added to the front of the queue (high-priority).
   * Otherwise, the request is added to the back of the queue (low-priority).
   *
   * @param {object} request - Request object to queue.
   * @param {boolean} [priority=false] - If true, adds request to front of queue; otherwise adds to back.
   */
  addRequest(request, priority = false) {
    if (request) {
      if (priority) {
        this.queue.unshift(request);
      } else {
        this.queue.push(request);
      }
    }
  }

  /**
   * Gets the next request from the queue.
   * Removes the request from the queue and marks the queue as busy.
   *
   * @returns {object|null} The next request, or null if busy or empty.
   */
  getNextRequest() {
    if (this.busy || !this.queue.length) {
      return null;
    }

    return this.queue.shift();
  }

  /**
   * Clears all queued requests.
   */
  clearQueue() {
    this.queue = [];
  }

  /**
   * Returns the number of queued requests.
   *
   * @returns {number}
   */
  size() {
    return this.queue.length;
  }

  /**
   * Returns whether the queue has pending requests.
   *
   * @returns {boolean}
   */
  hasRequests() {
    return this.queue.length > 0;
  }
}
