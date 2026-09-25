const privatePrefixes=["/api/","/auth/","/ws/"];
export function responseSecurityHeaders(pathname:string,contentType="application/json"):Headers {
 const h=new Headers({"x-content-type-options":"nosniff","referrer-policy":"strict-origin-when-cross-origin","content-type":contentType});
 if(privatePrefixes.some(p=>pathname.startsWith(p))) h.set("cache-control","private, no-store, max-age=0");
 else h.set("cache-control","public, max-age=0, must-revalidate");
 return h;
}
export function assertNoPrivateCaching(pathname:string,headers:Headers):void {
 if(privatePrefixes.some(p=>pathname.startsWith(p))&&!/no-store/i.test(headers.get("cache-control")??"")) throw new Error("CACHE_POLICY_VIOLATION");
}
