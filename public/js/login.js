/* 登录页逻辑 */
(function () {
  const form = document.getElementById('loginForm');
  const errorBox = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');
  const passwordInput = document.getElementById('password');

  // 已登录则直接进入书架
  apiGetJson('/api/auth/me')
    .then(() => {
      window.location.href = '/index.html';
    })
    .catch(() => {});

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.classList.remove('show');
    const password = passwordInput.value;
    if (!password) {
      errorBox.textContent = '请输入密码';
      errorBox.classList.add('show');
      return;
    }
    btn.disabled = true;
    btn.textContent = '登录中…';
    try {
      await apiPostJson('/api/auth/login', { password });
      window.location.href = '/index.html';
    } catch (err) {
      errorBox.textContent = err.message || '登录失败';
      errorBox.classList.add('show');
      btn.disabled = false;
      btn.textContent = '进入书库';
    }
  });
})();
