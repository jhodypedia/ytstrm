export const requireAuth = (req, res, next) => {
  if (!req.session || !req.session.tokens) return res.redirect('/auth/login');
  next();
};
