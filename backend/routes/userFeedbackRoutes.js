const express = require('express');
const { createUserFeedbackStore } = require('../lib/userFeedbackStore');
function createUserFeedbackRoutes({ requireLoggedInSession, storePath }) {
  const router = express.Router();
  const store = createUserFeedbackStore(storePath);
  const publicItem = item => ({ id:item.id, text:item.text, status:item.status, createdAt:item.createdAt, updatedAt:item.updatedAt, publicNote:item.publicNote, images:item.images.map((image,index)=>({ url:`/api/user-feedback/${item.id}/images/${index}` })) });
  router.use('/user-feedback', (req,res,next)=>{
    res.set('Cache-Control','private, no-store');
    const session = requireLoggedInSession(req,res);
    if (!session) return;
    if (!session.username) return res.status(401).json({error:'请先登录'});
    if (req.get('Origin')) {
      try { if (new URL(req.get('Origin')).hostname !== req.hostname) return res.status(403).json({error:'请从本站提交反馈'}); }
      catch { return res.status(403).json({error:'反馈来源无效'}); }
    }
    req.feedbackUser = session.username; next();
  });
  router.get('/user-feedback',async(req,res)=>{
    try { res.json({items:(await store.list(store.ownerHash(req.feedbackUser))).slice(0,50).map(publicItem)}); }
    catch { res.status(500).json({error:'反馈记录读取失败，请稍后重试'}); }
  });
  router.post('/user-feedback',async(req,res)=>{
    if (!req.is('application/json')) return res.status(415).json({error:'请使用本站反馈表单'});
    try { res.status(201).json({item:publicItem(await store.create(req.feedbackUser,req.body))}); }
    catch(error) { res.status(error.status || 500).json({error:error.status ? error.message : '反馈保存失败，内容已保留，请重试'}); }
  });
  router.get('/user-feedback/:id/images/:index',async(req,res)=>{
    try {
      const item = await store.get(req.params.id);
      const index = Number(req.params.index);
      if (!item || item.owner !== store.ownerHash(req.feedbackUser) || !Number.isInteger(index) || !item.images[index]) return res.status(404).json({error:'图片不存在'});
      res.set('X-Content-Type-Options','nosniff');
      res.type(item.images[index].type).sendFile(store.imagePath(item.id,item.images[index].name));
    } catch { res.status(404).json({error:'图片不存在'}); }
  });
  return router;
}
module.exports = { createUserFeedbackRoutes };
