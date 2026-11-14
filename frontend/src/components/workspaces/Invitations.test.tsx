import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {InvitationAcceptance,WorkspaceInvitationManager} from './Invitations';
import {useStore} from '@/hooks/useStore';
import {acceptWorkspaceInvitation,getInvitationCapabilities,createWorkspaceInvitation,listWorkspaceInvitations,revokeWorkspaceInvitation} from '@/lib/api';
vi.mock('@/lib/api',()=>({acceptWorkspaceInvitation:vi.fn(),getInvitationCapabilities:vi.fn(),createWorkspaceInvitation:vi.fn(),listWorkspaceInvitations:vi.fn(),revokeWorkspaceInvitation:vi.fn()}));
const user='22222222-2222-4222-8222-222222222222',ws='11111111-1111-4111-8111-111111111111',id='33333333-3333-4333-8333-333333333333';
const context={expectedUserId:user,workspaceId:ws};
const row={id,workspace_id:ws,created_by:user,recipient_email:'person@example.invalid',role:'viewer' as const,state:'pending' as const,created_at:'2026-10-09T00:00:00Z',expires_at:'2030-01-01T00:00:00Z'};
const inventory={invitations:[row],total:1,total_is_exact:true as const,next_after:null,schema_version:'040' as const};
beforeEach(()=>{vi.clearAllMocks();useStore.setState({authMode:'authenticated',authUser:{id:user,email:'owner@example.invalid'},workspaceId:ws});vi.mocked(listWorkspaceInvitations).mockResolvedValue(inventory);vi.mocked(getInvitationCapabilities).mockResolvedValue({invitation_supported:true,schema_version:"040"});});
describe('recipient-bound invitation UI',()=>{
 it('accepts only through an ephemeral POST client and refreshes discovery',async()=>{
  const onAccepted=vi.fn();vi.mocked(acceptWorkspaceInvitation).mockResolvedValue({accepted:true,workspace_id:ws,role:'viewer',schema_version:'040'});
  render(<InvitationAcceptance context={context} onAccepted={onAccepted}/>);
  const field=screen.getByLabelText('One-time invitation code');expect(field).toHaveAttribute('type','password');
  fireEvent.change(field,{target:{value:'a'.repeat(43)}});await waitFor(()=>expect(screen.getByRole('button',{name:'Accept invitation'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Accept invitation'}));
  await waitFor(()=>expect(onAccepted).toHaveBeenCalledOnce());expect(field).toHaveValue('');expect(window.localStorage.getItem('nexusrag.invitation')).toBeNull();
 });
 it('late prior-account acceptance cannot refresh the new account',async()=>{
  let resolve!:(v:{accepted:true;workspace_id:string;role:string;schema_version:'040'})=>void;vi.mocked(acceptWorkspaceInvitation).mockReturnValue(new Promise(r=>{resolve=r;}));
  const callback=vi.fn();const view=render(<InvitationAcceptance context={context} onAccepted={callback}/>);
  fireEvent.change(screen.getByLabelText('One-time invitation code'),{target:{value:'a'.repeat(43)}});await waitFor(()=>expect(screen.getByRole('button',{name:'Accept invitation'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Accept invitation'}));
  await waitFor(()=>expect(acceptWorkspaceInvitation).toHaveBeenCalledOnce());useStore.setState({authUser:{id:'other-account',email:'other@example.invalid'}});view.unmount();resolve({accepted:true,workspace_id:ws,role:'viewer',schema_version:'040'});await Promise.resolve();expect(callback).not.toHaveBeenCalled();
 });
 it('missing migration is shown as a real error, not membership success',async()=>{
  vi.mocked(acceptWorkspaceInvitation).mockRejectedValue(new Error('Verify migration 040.'));render(<InvitationAcceptance context={context} onAccepted={vi.fn()}/>);
  fireEvent.change(screen.getByLabelText('One-time invitation code'),{target:{value:'a'.repeat(43)}});await waitFor(()=>expect(screen.getByRole('button',{name:'Accept invitation'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Accept invitation'}));expect(await screen.findByRole('alert')).toHaveTextContent('migration 040');expect(screen.queryByText(/Workspace joined/)).not.toBeInTheDocument();
 });
 it('administrator cannot offer an administrator invitation',async()=>{
  render(<WorkspaceInvitationManager context={context} workspaceRole="admin"/>);await screen.findByText('1 of 1 pending invitations');expect(screen.queryByRole('option',{name:'Administrator'})).not.toBeInTheDocument();
 });
 it('ambiguous creation retry preserves the exact in-memory code and idempotency key',async()=>{
  vi.mocked(createWorkspaceInvitation).mockRejectedValueOnce(new Error('Outcome unknown; retry same request.')).mockResolvedValueOnce(row);
  render(<WorkspaceInvitationManager context={context} workspaceRole="owner"/>);await screen.findByText('1 of 1 pending invitations');
  fireEvent.change(screen.getByLabelText('Invitation recipient email'),{target:{value:'person@example.invalid'}});fireEvent.click(screen.getByRole('button',{name:'Create invitation'}));await screen.findByRole('alert');
  const first=vi.mocked(createWorkspaceInvitation).mock.calls[0][0];expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  fireEvent.click(screen.getByRole('button',{name:'Create invitation'}));await waitFor(()=>expect(createWorkspaceInvitation).toHaveBeenCalledTimes(2));expect(vi.mocked(createWorkspaceInvitation).mock.calls[1][0]).toEqual(first);
  const code=await screen.findByLabelText('Copy this code now; it is not recoverable later');expect(code).toHaveValue(first.token);fireEvent.click(screen.getByRole('button',{name:'Dismiss code'}));expect(screen.queryByLabelText('Copy this code now; it is not recoverable later')).not.toBeInTheDocument();
 });
 it('revokes only the selected invitation and refreshes the real inventory',async()=>{
  vi.mocked(revokeWorkspaceInvitation).mockResolvedValue({success:true});render(<WorkspaceInvitationManager context={context} workspaceRole="owner"/>);await screen.findByText('1 of 1 pending invitations');fireEvent.click(screen.getByRole('button',{name:'Revoke invitation for person@example.invalid'}));await waitFor(()=>expect(revokeWorkspaceInvitation).toHaveBeenCalledWith(id,context));await waitFor(()=>expect(listWorkspaceInvitations).toHaveBeenCalledTimes(2));
 });
});

it('unverified environment cannot enable invitation acceptance',async()=>{
 vi.mocked(getInvitationCapabilities).mockResolvedValue({invitation_supported:false,state:'MIGRATION_REQUIRED'});
 render(<InvitationAcceptance context={context} onAccepted={vi.fn()}/>);
 await screen.findByText('Invitations are unavailable until migration 040 is verified on this environment.');
 fireEvent.change(screen.getByLabelText('One-time invitation code'),{target:{value:'a'.repeat(43)}});
 expect(screen.getByRole('button',{name:'Accept invitation'})).toBeDisabled();expect(acceptWorkspaceInvitation).not.toHaveBeenCalled();
});
