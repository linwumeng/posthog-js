import { init_as_module, PostHogLib } from '../posthog-core'
import { PostHogPersistence } from '../posthog-persistence'
import { CaptureMetrics } from '../capture-metrics'
import { _ } from '../utils'
import { Decide } from '../decide'
import { autocapture } from '../autocapture'

jest.mock('../gdpr-utils', () => ({
    ...jest.requireActual('../gdpr-utils'),
    addOptOutCheckPostHogLib: (fn) => fn,
    addOptOutCheckPostHogPeople: (fn) => fn,
}))
jest.mock('../decide')

given('lib', () => Object.assign(new PostHogLib(), given.overrides))

describe('identify()', () => {
    given('subject', () => () =>
        given.lib.identify(given.identity, given.userPropertiesToSet, given.userPropertiesToSetOnce)
    )

    given('identity', () => 'a-new-id')

    given('overrides', () => ({
        get_distinct_id: () => given.oldIdentity,
        capture: jest.fn(),
        register: jest.fn(),
        register_once: jest.fn(),
        unregister: jest.fn(),
        get_property: () => given.deviceId,
        people: {
            set: jest.fn(),
            set_once: jest.fn(),
        },
        _flags: {},
        _captureMetrics: {
            incr: jest.fn(),
        },
        reloadFeatureFlags: jest.fn(),
    }))

    given('properties', () => ({ $device_id: '123', __alias: 'efg' }))
    given('oldIdentity', () => 'oldIdentity')
    given('deviceId', () => given.oldIdentity)

    it('registers new user id and updates alias', () => {
        given.subject()

        expect(given.overrides.register).toHaveBeenCalledWith({ $user_id: 'a-new-id' })
        expect(given.overrides.register).toHaveBeenCalledWith({ distinct_id: 'a-new-id' })
    })

    it('calls capture when identity changes', () => {
        given.subject()

        expect(given.overrides.capture).toHaveBeenCalledWith(
            '$identify',
            {
                distinct_id: 'a-new-id',
                $anon_distinct_id: 'oldIdentity',
            },
            { $set: {} },
            { $set_once: {} }
        )
        expect(given.overrides.people.set).not.toHaveBeenCalled()
    })

    it('calls capture when identity changes and old ID is anonymous', () => {
        given('deviceId', () => null)

        given.subject()

        expect(given.overrides.capture).toHaveBeenCalledWith(
            '$identify',
            {
                distinct_id: 'a-new-id',
                $anon_distinct_id: 'oldIdentity',
            },
            { $set: {} },
            { $set_once: {} }
        )
        expect(given.overrides.people.set).not.toHaveBeenCalled()
    })

    it("don't identify if the old id isn't anonymous", () => {
        given('deviceId', () => 'anonymous-id')

        given.subject()

        expect(given.overrides.capture).not.toHaveBeenCalled()
        expect(given.overrides.people.set).not.toHaveBeenCalled()
    })

    it('calls capture with user properties if passed', () => {
        given('userPropertiesToSet', () => ({ email: 'john@example.com' }))
        given('userPropertiesToSetOnce', () => ({ howOftenAmISet: 'once!' }))

        given.subject()

        expect(given.overrides.capture).toHaveBeenCalledWith(
            '$identify',
            {
                distinct_id: 'a-new-id',
                $anon_distinct_id: 'oldIdentity',
            },
            { $set: { email: 'john@example.com' } },
            { $set_once: { howOftenAmISet: 'once!' } }
        )
    })

    describe('identity did not change', () => {
        given('oldIdentity', () => given.identity)

        it('does not capture or set user properties', () => {
            given.subject()

            expect(given.overrides.capture).not.toHaveBeenCalled()
            expect(given.overrides.people.set).not.toHaveBeenCalled()
        })

        it('calls people.set when user properties passed', () => {
            given('userPropertiesToSet', () => ({ email: 'john@example.com' }))
            given('userPropertiesToSetOnce', () => ({ howOftenAmISet: 'once!' }))

            given.subject()

            expect(given.overrides.capture).not.toHaveBeenCalled()
            expect(given.overrides.people.set).toHaveBeenCalledWith({ email: 'john@example.com' })
            expect(given.overrides.people.set_once).toHaveBeenCalledWith({ howOftenAmISet: 'once!' })
        })
    })

    describe('invalid id passed', () => {
        given('identity', () => null)

        it('does not update user', () => {
            given.subject()

            expect(given.overrides.capture).not.toHaveBeenCalled()
            expect(given.overrides.register).not.toHaveBeenCalled()
        })
    })

    describe('reloading feature flags', () => {
        it('reloads when identity changes', () => {
            given.subject()

            expect(given.overrides.reloadFeatureFlags).toHaveBeenCalled()
        })

        it('does not reload feature flags if identity does not change', () => {
            given('oldIdentity', () => given.identity)

            given.subject()

            expect(given.overrides.reloadFeatureFlags).not.toHaveBeenCalled()
        })

        it('does not reload feature flags if identity does not change but properties do', () => {
            given('oldIdentity', () => given.identity)
            given('userPropertiesToSet', () => ({ email: 'john@example.com' }))
            given('userPropertiesToSetOnce', () => ({ howOftenAmISet: 'once!' }))

            given.subject()

            expect(given.overrides.reloadFeatureFlags).not.toHaveBeenCalled()
        })
    })
})

describe('capture()', () => {
    given('eventName', () => '$event')

    given('subject', () => () =>
        given.lib.capture(given.eventName, given.eventProperties, given.options, given.callback)
    )

    given('overrides', () => ({
        __loaded: true,
        get_config: (key) => given.config?.[key],
        config: {
            _onCapture: jest.fn(),
        },
        persistence: {
            remove_event_timer: jest.fn(),
            update_search_keyword: jest.fn(),
            update_campaign_params: jest.fn(),
            properties: jest.fn(),
        },
        compression: {},
        _captureMetrics: new CaptureMetrics(),
        __captureHooks: [],
    }))

    it('handles recursive objects', () => {
        given('eventProperties', () => {
            const props = {}
            props.recurse = props
            return props
        })

        expect(() => given.subject()).not.toThrow()
    })

    it('calls callbacks added via _addCaptureHook', () => {
        const hook = jest.fn()

        given.lib._addCaptureHook(hook)

        given.subject()

        expect(hook).toHaveBeenCalledWith('$event')
    })

    it('errors with undefined event name', () => {
        given('eventName', () => undefined)

        const hook = jest.fn()
        given.lib._addCaptureHook(hook)

        expect(() => given.subject()).not.toThrow()
        expect(hook).not.toHaveBeenCalled()
    })

    it('errors with object event name', () => {
        given('eventName', () => ({ event: 'object as name' }))

        const hook = jest.fn()
        given.lib._addCaptureHook(hook)

        expect(() => given.subject()).not.toThrow()
        expect(hook).not.toHaveBeenCalled()
    })

    it('truncates long properties', () => {
        given('config', () => ({
            properties_string_max_length: 1000,
        }))
        given('eventProperties', () => ({
            key: 'value'.repeat(10000),
        }))
        const event = given.subject()
        expect(event.properties.key.length).toBe(1000)
    })

    it('keeps long properties if null', () => {
        given('config', () => ({
            properties_string_max_length: null,
        }))
        given('eventProperties', () => ({
            key: 'value'.repeat(10000),
        }))
        const event = given.subject()
        expect(event.properties.key.length).toBe(50000)
    })

    describe('capturing window performance', () => {
        given('eventName', () => '$pageview')

        given('config', () => ({
            _capture_performance: true,
        }))

        given('performanceEntries', () => ({
            navigation: [{ duration: 1234 }],
            paint: [{ a: 'b' }],
            resource: [{ c: 'd' }],
        }))

        // e.g. IE does not implement performance paint timing
        // https://developer.mozilla.org/en-US/docs/Web/API/PerformancePaintTiming
        // even though it implements getEntriesByType
        given('paintTimingsImplementedByBrowser', () => true)

        given('clearResourceTimings', () => jest.fn())

        given('getEntriesByType', () =>
            jest.fn().mockImplementation((type) => {
                if (!given.paintTimingsImplementedByBrowser && type === 'paint') {
                    throw new Error('IE does not implement this')
                } else {
                    return given.performanceEntries[type]
                }
            })
        )

        beforeEach(() => {
            /*
                window.performance is not a complete implementation in jsdom
                see github issue https://github.com/jsdom/jsdom/issues/3309
                while it is not completely implemented we can follow the Jest instructions
                here: https://jestjs.io/docs/manual-mocks#mocking-methods-which-are-not-implemented-in-jsdom
             */

            Object.defineProperty(window, 'performance', {
                writable: true,
                value: {
                    getEntriesByType: given.getEntriesByType,
                    clearResourceTimings: given.clearResourceTimings,
                },
            })
        })

        it('does not capture performance when disabled', () => {
            given('config', () => ({
                _capture_performance: false,
            }))

            given.subject()

            expect(given.getEntriesByType).not.toHaveBeenCalled()
            expect(given.clearResourceTimings).not.toHaveBeenCalled()
        })

        it('captures pageview with performance when enabled', () => {
            const captured_event = given.subject()

            expect(captured_event.properties).toHaveProperty(
                '$performance_raw',
                '{"navigation":[["duration"],[[1234]]],"paint":[["a"],[["b"]]],"resource":[["c"],[["d"]]]}'
            )

            expect(captured_event.properties).toHaveProperty('$performance_page_loaded', 1234)

            expect(given.getEntriesByType).toHaveBeenCalledTimes(3)
            expect(given.getEntriesByType).toHaveBeenNthCalledWith(1, 'navigation')
            expect(given.getEntriesByType).toHaveBeenNthCalledWith(2, 'paint')
            expect(given.getEntriesByType).toHaveBeenNthCalledWith(3, 'resource')
            expect(given.clearResourceTimings).toHaveBeenCalled()
        })

        it('captures pageview with performance even if duration is not available', () => {
            given('performanceEntries', () => ({
                navigation: [{}],
                paint: [{ a: 'b' }],
                resource: [{ c: 'd' }],
            }))

            const captured_event = given.subject()

            expect(captured_event.properties).toHaveProperty(
                '$performance_raw',
                '{"navigation":[[],[[]]],"paint":[["a"],[["b"]]],"resource":[["c"],[["d"]]]}'
            )

            expect(captured_event.properties).not.toHaveProperty('$performance_page_loaded')
        })

        it('safely attempts to capture pageview with performance when enabled but not available in browser', () => {
            delete window.performance

            const captured_event = given.subject()

            expect(captured_event.properties).toHaveProperty(
                '$performance_raw',
                JSON.stringify({
                    navigation: [],
                    paint: [],
                    resource: [],
                })
            )
        })

        it('safely attempts to capture pageview with performance when enabled but getEntriesByType is not available in browser', () => {
            delete window.performance.getEntriesByType

            const captured_event = given.subject()

            expect(captured_event.properties).toHaveProperty(
                '$performance_raw',
                JSON.stringify({
                    navigation: [],
                    paint: [],
                    resource: [],
                })
            )
        })

        it('safely attempts to capture performance if a type of entry is not available in a browser', () => {
            given('paintTimingsImplementedByBrowser', () => false)

            const captured_event = given.subject()

            expect(captured_event.properties).toHaveProperty(
                '$performance_raw',
                '{"navigation":[["duration"],[[1234]]],"paint":[],"resource":[["c"],[["d"]]]}'
            )
        })
    })
})

describe('_calculate_event_properties()', () => {
    given('subject', () =>
        given.lib._calculate_event_properties(given.event_name, given.properties, given.start_timestamp, given.options)
    )

    given('event_name', () => 'custom_event')
    given('properties', () => ({ event: 'prop' }))

    given('options', () => ({}))

    given('overrides', () => ({
        get_config: (key) => given.config[key],
        persistence: {
            properties: () => ({ distinct_id: 'abc', persistent: 'prop' }),
        },
        sessionManager: {
            checkAndGetSessionAndWindowId: jest.fn().mockReturnValue({
                windowId: 'windowId',
                sessionId: 'sessionId',
            }),
        },
    }))

    given('config', () => ({
        token: 'testtoken',
        property_blacklist: given.property_blacklist,
        sanitize_properties: given.sanitize_properties,
    }))

    beforeEach(() => {
        jest.spyOn(_.info, 'properties').mockReturnValue({ $lib: 'web' })
    })

    it('returns calculated properties', () => {
        expect(given.subject).toEqual({
            token: 'testtoken',
            event: 'prop',
            $lib: 'web',
            distinct_id: 'abc',
            persistent: 'prop',
            $window_id: 'windowId',
            $session_id: 'sessionId',
        })
    })

    it('respects property_blacklist', () => {
        given('property_blacklist', () => ['$lib', 'persistent'])

        expect(given.subject).toEqual({
            token: 'testtoken',
            event: 'prop',
            distinct_id: 'abc',
            $window_id: 'windowId',
            $session_id: 'sessionId',
        })
    })

    it('only adds token and distinct_id if event_name is $snapshot', () => {
        given('event_name', () => '$snapshot')
        expect(given.subject).toEqual({
            token: 'testtoken',
            event: 'prop',
            distinct_id: 'abc',
        })
        expect(given.overrides.sessionManager.checkAndGetSessionAndWindowId).not.toHaveBeenCalled()
    })

    it('calls sanitize_properties', () => {
        given('sanitize_properties', () => (props, event_name) => ({ token: props.token, event_name }))

        expect(given.subject).toEqual({
            event_name: given.event_name,
            token: 'testtoken',
        })
    })

    it('saves $snapshot data and token for $snapshot events', () => {
        given('event_name', () => '$snapshot')
        given('properties', () => ({ $snapshot_data: {} }))

        expect(given.subject).toEqual({
            token: 'testtoken',
            $snapshot_data: {},
            distinct_id: 'abc',
        })
    })

    it("doesn't modify properties passed into it", () => {
        const properties = { prop1: 'val1', prop2: 'val2' }
        given.lib._calculate_event_properties(given.event_name, properties, given.start_timestamp, given.options)

        expect(Object.keys(properties)).toEqual(['prop1', 'prop2'])
    })
})

describe('_handle_unload()', () => {
    given('subject', () => () => given.lib._handle_unload())

    given('overrides', () => ({
        get_config: (key) => given.config[key],
        capture: jest.fn(),
        compression: {},
        _requestQueue: {
            unload: jest.fn(),
        },
        _retryQueue: {
            unload: jest.fn(),
        },
    }))

    given('config', () => ({
        capture_pageview: given.capturePageviews,
        request_batching: given.batching,
    }))

    given('capturePageviews', () => true)
    given('batching', () => true)

    it('captures $pageleave', () => {
        given.subject()

        expect(given.overrides.capture).toHaveBeenCalledWith('$pageleave')
    })

    it('does not capture $pageleave when capture_pageview=false', () => {
        given('capturePageviews', () => false)

        given.subject()

        expect(given.overrides.capture).not.toHaveBeenCalled()
    })

    it('calls requestQueue unload', () => {
        given.subject()

        expect(given.overrides._requestQueue.unload).toHaveBeenCalledTimes(1)
    })

    describe('without batching', () => {
        given('batching', () => false)

        it('captures $pageleave', () => {
            given.subject()

            expect(given.overrides.capture).toHaveBeenCalledWith('$pageleave', null, { transport: 'sendbeacon' })
        })

        it('does not capture $pageleave when capture_pageview=false', () => {
            given('capturePageviews', () => false)

            given.subject()

            expect(given.overrides.capture).not.toHaveBeenCalled()
        })
    })
})

describe('__compress_and_send_json_request', () => {
    given('subject', () => () =>
        given.lib.__compress_and_send_json_request('/e/', given.jsonData, given.options, jest.fn())
    )

    given('jsonData', () => JSON.stringify({ large_key: new Array(500).join('abc') }))

    given('overrides', () => ({
        compression: {},
        _send_request: jest.fn(),
        get_config: () => false,
    }))

    it('handles base64 compression', () => {
        given('compression', () => ({}))

        given.subject()

        expect(given.overrides._send_request.mock.calls).toMatchSnapshot()
    })
})

describe('init()', () => {
    given('subject', () => () => given.lib.init())

    given('overrides', () => ({
        get_distinct_id: () => 'distinct_id_987',
        advanced_disable_decide: given.advanced_disable_decide,
        _send_request: jest.fn(),
        capture: jest.fn(),
    }))

    beforeEach(() => {
        jest.spyOn(window.console, 'warn').mockImplementation()
        jest.spyOn(window.console, 'error').mockImplementation()
        jest.spyOn(autocapture, 'init').mockImplementation()
        jest.spyOn(autocapture, 'afterDecideResponse').mockImplementation()
    })

    given('advanced_disable_decide', () => true)

    it('can set an xhr error handler', () => {
        init_as_module()
        const fakeOnXHRError = 'configured error'
        given('subject', () =>
            given.lib.init(
                'a-token',
                {
                    on_xhr_error: fakeOnXHRError,
                },
                'a-name'
            )
        )
        expect(given.subject.get_config('on_xhr_error')).toBe(fakeOnXHRError)
    })

    it('does not load decide endpoint on advanced_disable_decide', () => {
        given.subject()
        expect(given.decide).toBe(undefined)
        expect(given.overrides._send_request.mock.calls.length).toBe(0) // No outgoing requests
    })

    it('does not load autocapture, feature flags, toolbar, session recording or compression', () => {
        given('overrides', () => {
            return {
                sessionRecording: {
                    afterDecideResponse: jest.fn(),
                },
                toolbar: {
                    afterDecideResponse: jest.fn(),
                },
                persistence: {
                    register: jest.fn(),
                },
            }
        })

        given.subject()

        jest.spyOn(given.lib.toolbar, 'afterDecideResponse').mockImplementation()
        jest.spyOn(given.lib.sessionRecording, 'afterDecideResponse').mockImplementation()
        jest.spyOn(given.lib.persistence, 'register').mockImplementation()

        // Autocapture
        expect(given.lib['__autocapture_enabled']).toBe(undefined)
        expect(autocapture.init).toHaveBeenCalledTimes(0)
        expect(autocapture.afterDecideResponse).toHaveBeenCalledTimes(0)

        // Feature flags
        expect(given.lib.persistence.register).toHaveBeenCalledTimes(0) // FFs are saved this way

        // Toolbar
        expect(given.lib.toolbar.afterDecideResponse).toHaveBeenCalledTimes(0)

        // Session recording
        expect(given.lib.sessionRecording.afterDecideResponse).toHaveBeenCalledTimes(0)

        // Compression
        expect(given.lib['compression']).toBe(undefined)
    })
})

describe('skipped init()', () => {
    it('capture() does not throw', () => {
        expect(() => given.lib.capture('$pageview')).not.toThrow()
    })
})

describe('group()', () => {
    given('captureQueue', () => jest.fn())
    given('overrides', () => ({
        persistence: new PostHogPersistence(given.config),
        capture: jest.fn(),
        _captureMetrics: {
            incr: jest.fn(),
        },
        reloadFeatureFlags: jest.fn(),
    }))
    given('config', () => ({
        request_batching: true,
        persistence: 'memory',
        property_blacklist: [],
        _onCapture: jest.fn(),
    }))

    beforeEach(() => {
        given.overrides.persistence.clear()
    })

    it('records info on groups', () => {
        given.lib.group('organization', 'org::5')
        expect(given.lib.getGroups()).toEqual({ organization: 'org::5' })

        given.lib.group('organization', 'org::6')
        expect(given.lib.getGroups()).toEqual({ organization: 'org::6' })

        given.lib.group('instance', 'app.posthog.com')
        expect(given.lib.getGroups()).toEqual({ organization: 'org::6', instance: 'app.posthog.com' })
    })

    it('does not result in a capture call', () => {
        given.lib.group('organization', 'org::5')

        expect(given.overrides.capture).not.toHaveBeenCalled()
    })

    it('results in a reloadFeatureFlags call if group changes', () => {
        given.lib.group('organization', 'org::5')
        given.lib.group('instance', 'app.posthog.com')
        given.lib.group('organization', 'org::5')

        expect(given.overrides.reloadFeatureFlags).toHaveBeenCalledTimes(2)
    })

    it('captures $groupidentify event', () => {
        given.lib.group('organization', 'org::5', { group: 'property', foo: 5 })

        expect(given.overrides.capture).toHaveBeenCalledWith('$groupidentify', {
            $group_type: 'organization',
            $group_key: 'org::5',
            $group_set: {
                group: 'property',
                foo: 5,
            },
        })
    })

    describe('subsequent capture calls', () => {
        given('overrides', () => ({
            __loaded: true,
            config: given.config,
            persistence: new PostHogPersistence(given.config),
            _requestQueue: {
                enqueue: given.captureQueue,
            },
            _captureMetrics: {
                incr: jest.fn(),
            },
            reloadFeatureFlags: jest.fn(),
        }))

        it('sends group information in event properties', () => {
            given.lib.group('organization', 'org::5')
            given.lib.group('instance', 'app.posthog.com')

            given.lib.capture('some_event', { prop: 5 })

            expect(given.captureQueue).toHaveBeenCalledTimes(1)

            const [_endpoint, eventPayload] = given.captureQueue.mock.calls[0]
            expect(eventPayload.event).toEqual('some_event')
            expect(eventPayload.properties.$groups).toEqual({
                organization: 'org::5',
                instance: 'app.posthog.com',
            })
        })
    })

    describe('error handling', () => {
        given('overrides', () => ({
            register: jest.fn(),
        }))

        it('handles blank keys being passed', () => {
            window.console.error = jest.fn()

            given.lib.group(null, 'foo')
            given.lib.group('organization', null)
            given.lib.group('organization', undefined)
            given.lib.group('organization', '')
            given.lib.group('', 'foo')

            expect(given.overrides.register).not.toHaveBeenCalled()
        })
    })
})

describe('_loaded()', () => {
    given('subject', () => () => given.lib._loaded())

    given('overrides', () => ({
        get_config: (key) => given.config?.[key],
        capture: jest.fn(),
        featureFlags: {
            setReloadingPaused: jest.fn(),
            resetRequestQueue: jest.fn(),
        },
        _start_queue_if_opted_in: jest.fn(),
    }))
    given('config', () => ({}))

    it('calls loafed config option', () => {
        given('config', () => ({ loaded: jest.fn() }))

        given.subject()

        expect(given.config.loaded).toHaveBeenCalledWith(given.lib)
    })

    it('handles loaded config option throwing gracefully', () => {
        given('config', () => ({
            loaded: () => {
                throw Error()
            },
        }))

        given.subject()
    })

    describe('/decide', () => {
        beforeEach(() => {
            const call = jest.fn()
            Decide.mockImplementation(() => ({ call }))
        })

        it('is called by default', () => {
            given.subject()

            expect(new Decide().call).toHaveBeenCalled()
        })

        it('does not call decide if disabled', () => {
            given('config', () => ({
                advanced_disable_decide: true,
            }))

            given.subject()

            expect(new Decide().call).not.toHaveBeenCalled()
        })
    })

    describe('capturing pageviews', () => {
        it('captures not capture pageview if disabled', () => {
            given('config', () => ({
                capture_pageview: false,
            }))

            given.subject()

            expect(given.overrides.capture).not.toHaveBeenCalled()
        })

        it('captures pageview if enabled', () => {
            given('config', () => ({
                capture_pageview: true,
            }))

            given.subject()

            expect(given.overrides.capture).toHaveBeenCalledWith('$pageview', {}, { send_instantly: true })
        })
    })

    it('toggles feature flags on and off', () => {
        given.subject()

        expect(given.overrides.featureFlags.setReloadingPaused).toHaveBeenCalledWith(true)
        expect(given.overrides.featureFlags.setReloadingPaused).toHaveBeenCalledWith(false)
        expect(given.overrides.featureFlags.resetRequestQueue).toHaveBeenCalled()
    })
})
