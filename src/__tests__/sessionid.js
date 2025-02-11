import { SessionIdManager } from '../sessionid'
import { SESSION_ID } from '../posthog-persistence'
import { _ } from '../utils'
import { sessionStore } from '../storage'

jest.mock('../utils')
jest.mock('../storage')

describe('Session ID manager', () => {
    given('subject', () => given.sessionIdManager.checkAndGetSessionAndWindowId(given.readOnly, given.timestamp))
    given('sessionIdManager', () => new SessionIdManager(given.config, given.persistence))

    given('persistence', () => ({
        props: { [SESSION_ID]: given.storedSessionIdData },
        register: jest.fn(),
        disabled: given.disable_persistence,
    }))
    given('disable_persistence', () => false)

    given('config', () => ({
        persistence_name: 'persistance-name',
    }))

    given('timestamp', () => 1603107479471)

    beforeEach(() => {
        _.UUID.mockReturnValue('newUUID')
        sessionStore.is_supported.mockReturnValue(true)
        const mockDate = new Date(1603107460000)
        jest.spyOn(global, 'Date').mockImplementation(() => mockDate)
    })

    describe('new session id manager', () => {
        it('generates an initial session id and window id, and saves them', () => {
            expect(given.subject).toMatchObject({
                windowId: 'newUUID',
                sessionId: 'newUUID',
            })
            expect(given.persistence.register).toHaveBeenCalledWith({ [SESSION_ID]: [given.timestamp, 'newUUID'] })
            expect(sessionStore.set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newUUID')
        })

        it('generates an initial session id and window id, and saves them even if readOnly is true', () => {
            given('readOnly', () => true)
            expect(given.subject).toMatchObject({
                windowId: 'newUUID',
                sessionId: 'newUUID',
            })
            expect(given.persistence.register).toHaveBeenCalledWith({ [SESSION_ID]: [given.timestamp, 'newUUID'] })
            expect(sessionStore.set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newUUID')
        })
    })

    describe('stored session data', () => {
        given('storedSessionIdData', () => [1603107460000, 'oldSessionID'])
        beforeEach(() => {
            sessionStore.parse.mockReturnValue('oldWindowID')
        })

        it('reuses old ids and updates the session timestamp if not much time has passed', () => {
            expect(given.subject).toEqual({
                windowId: 'oldWindowID',
                sessionId: 'oldSessionID',
            })
            expect(given.persistence.register).toHaveBeenCalledWith({ [SESSION_ID]: [given.timestamp, 'oldSessionID'] })
        })

        it('reuses old ids and does not update the session timestamp if  > 30m pass and readOnly is true', () => {
            const old_timestamp = 1602107460000
            given('storedSessionIdData', () => [old_timestamp, 'oldSessionID'])
            given('readOnly', () => true)

            expect(given.subject).toEqual({
                windowId: 'oldWindowID',
                sessionId: 'oldSessionID',
            })
            expect(given.persistence.register).toHaveBeenCalledWith({ [SESSION_ID]: [old_timestamp, 'oldSessionID'] })
        })

        it('generates only a new window id, and saves it when there is no previous window id set', () => {
            sessionStore.parse.mockReturnValue(null)
            expect(given.subject).toEqual({
                windowId: 'newUUID',
                sessionId: 'oldSessionID',
            })
            expect(given.persistence.register).toHaveBeenCalledWith({ [SESSION_ID]: [given.timestamp, 'oldSessionID'] })
            expect(sessionStore.set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newUUID')
        })

        it('generates a new session id and window id, and saves it when >30m since last event', () => {
            const old_timestamp = 1602107460000
            given('storedSessionIdData', () => [old_timestamp, 'oldSessionID'])

            expect(given.subject).toEqual({
                windowId: 'newUUID',
                sessionId: 'newUUID',
            })
            expect(given.persistence.register).toHaveBeenCalledWith({ [SESSION_ID]: [given.timestamp, 'newUUID'] })
            expect(sessionStore.set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newUUID')
        })

        it('uses the current time if no timestamp is provided', () => {
            const old_timestamp = 1601107460000
            given('storedSessionIdData', () => [old_timestamp, 'oldSessionID'])
            given('timestamp', () => undefined)
            expect(given.subject).toEqual({
                windowId: 'newUUID',
                sessionId: 'newUUID',
            })
            expect(given.persistence.register).toHaveBeenCalledWith({ [SESSION_ID]: [1603107460000, 'newUUID'] })
        })
    })

    describe('window id storage', () => {
        it('stores and retrieves a window_id', () => {
            given.sessionIdManager._setWindowId('newWindowId')
            expect(given.sessionIdManager._getWindowId()).toEqual('newWindowId')
            expect(sessionStore.set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newWindowId')
        })
        it('stores and retrieves a window_id if persistance is disabled and storage is not used', () => {
            given('disable_persistence', () => true)
            given.sessionIdManager._setWindowId('newWindowId')
            expect(given.sessionIdManager._getWindowId()).toEqual('newWindowId')
            expect(sessionStore.set).not.toHaveBeenCalled()
        })
        it('stores and retrieves a window_id if sessionStoage is not supported', () => {
            sessionStore.is_supported.mockReturnValue(false)
            given.sessionIdManager._setWindowId('newWindowId')
            expect(given.sessionIdManager._getWindowId()).toEqual('newWindowId')
            expect(sessionStore.set).not.toHaveBeenCalled()
        })
    })

    describe('session id storage', () => {
        it('stores and retrieves a session id and timestamp', () => {
            given.sessionIdManager._setSessionId('newSessionId', 1603107460000)
            expect(given.sessionIdManager._getSessionId()).toEqual([1603107460000, 'newSessionId'])
            expect(given.persistence.register).toHaveBeenCalledWith({ [SESSION_ID]: [1603107460000, 'newSessionId'] })
        })
    })

    describe('reset session id', () => {
        it('clears the existing session id', () => {
            given.sessionIdManager.resetSessionId()
            expect(given.persistence.register).toHaveBeenCalledWith({ [SESSION_ID]: [null, null] })
        })
        it('a new session id is generated when called', () => {
            given('storedSessionIdData', () => [null, null])
            expect(given.sessionIdManager._getSessionId()).toEqual([null, null])
            expect(given.subject).toMatchObject({
                windowId: 'newUUID',
                sessionId: 'newUUID',
            })
        })
    })
})
