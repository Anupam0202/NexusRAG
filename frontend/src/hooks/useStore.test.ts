import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './useStore';
const userA={id:'user-a',email:'a@example.test'};
const userB={id:'user-b',email:'b@example.test'};
describe('account and workspace state isolation',()=>{
 beforeEach(()=>{localStorage.clear();useStore.setState({authMode:'loading',authUser:null,workspaceId:null,messages:[],documents:[],userApiKey:null,isQuotaBlocked:false,showApiKeyModal:false});});
 function populate(){useStore.getState().addUserMessage('private tenant evidence');useStore.getState().setUserApiKey('synthetic-test-key');useStore.getState().setIsQuotaBlocked(true);}
 it('clears sensitive data and rotates conversation on sign-out',()=>{useStore.getState().setAuthState('authenticated',userA);useStore.getState().setWorkspaceId('workspace-a');populate();const before=useStore.getState().sessionId;useStore.getState().setAuthState('signed_out');const s=useStore.getState();expect(s.messages).toEqual([]);expect(s.documents).toEqual([]);expect(s.userApiKey).toBeNull();expect(s.workspaceId).toBeNull();expect(s.sessionId).not.toBe(before);expect(localStorage.getItem('nexusrag.workspace_id')).toBeNull();});
 it('clears the old tenant context when workspace changes',()=>{useStore.getState().setAuthState('authenticated',userA);useStore.getState().setWorkspaceId('workspace-a');populate();const before=useStore.getState().sessionId;useStore.getState().setWorkspaceId('workspace-b');expect(useStore.getState().sessionId).not.toBe(before);expect(useStore.getState().messages).toEqual([]);expect(useStore.getState().userApiKey).toBeNull();});
 it('does not reset the active conversation on token refresh',()=>{useStore.getState().setAuthState('authenticated',userA);useStore.getState().setWorkspaceId('workspace-a');populate();const before=useStore.getState().sessionId;useStore.getState().setAuthState('authenticated',userA);expect(useStore.getState().sessionId).toBe(before);expect(useStore.getState().messages).toHaveLength(1);});
 it('never reuses another account workspace or chat state',()=>{useStore.getState().setAuthState('authenticated',userA);useStore.getState().setWorkspaceId('workspace-a');populate();useStore.getState().setAuthState('authenticated',userB);expect(useStore.getState().workspaceId).toBeNull();expect(useStore.getState().messages).toEqual([]);expect(useStore.getState().isQuotaBlocked).toBe(false);});
});
