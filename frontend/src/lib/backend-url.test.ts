import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBackendBaseUrl } from './backend-url';
afterEach(()=>vi.unstubAllEnvs());
describe('backend URL credential transport safety',()=>{
 for(const url of ['http://gateway.example.test','https://user:password@gateway.example.test','https://gateway.example.test?token=secret','https://gateway.example.test#secret']){
  it(`rejects unsafe configuration ${new URL(url).origin}`,()=>{vi.stubEnv('NEXT_PUBLIC_API_URL',url);expect(()=>getBackendBaseUrl()).toThrow();});
 }
 it('allows the HTTPS gateway origin',()=>{vi.stubEnv('NEXT_PUBLIC_API_URL','https://gateway.example.test/');expect(getBackendBaseUrl()).toBe('https://gateway.example.test');});
 it('allows loopback HTTP for local development',()=>{vi.stubEnv('NEXT_PUBLIC_API_URL','http://localhost:8000');expect(getBackendBaseUrl()).toBe('http://localhost:8000');});
});
