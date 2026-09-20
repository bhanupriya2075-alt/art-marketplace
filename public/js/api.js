/* Small fetch wrapper + session store. */
(function () {
  'use strict';

  const TOKEN_KEY = 'asm.token';
  const USER_KEY = 'asm.user';

  const session = {
    get token() { return localStorage.getItem(TOKEN_KEY); },
    get user() {
      try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
      catch (e) { return null; }
    },
    save(token, user) {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    },
    clear() {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    },
    get isAdmin() {
      const u = this.user;
      return !!u && u.role === 'admin';
    },
  };

  async function request(method, path, body, isForm) {
    const headers = {};
    if (session.token) headers.Authorization = `Bearer ${session.token}`;
    if (body && !isForm) headers['Content-Type'] = 'application/json';

    const res = await fetch(`/api${path}`, {
      method, headers,
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });

    if (res.status === 204) return null;
    const type = res.headers.get('content-type') || '';
    if (!type.includes('application/json')) {
      if (!res.ok) throw new Error('Request failed.');
      return res;
    }

    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401 && session.token) {
        session.clear();
        location.hash = '#/signin';
      }
      throw new Error(data.error || 'Request failed.');
    }
    return data;
  }

  window.api = {
    session,
    get: (p) => request('GET', p),
    post: (p, b) => request('POST', p, b),
    patch: (p, b) => request('PATCH', p, b),
    del: (p) => request('DELETE', p),
    form: (p, fd) => request('POST', p, fd, true),
  };
})();
