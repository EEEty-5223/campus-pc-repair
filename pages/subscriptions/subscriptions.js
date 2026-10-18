var portal=require('../../utils/portal-api'),page=require('../../utils/portal-page')
Page(page({
  data:{loading:true,error:'',busy:false,status:null,staff:false,appointmentId:'',pending:false},
  onLoad:function(o){this.setData({staff:o.scope==='staff',appointmentId:o.id||''})},
  clearPrivate:function(){this._pending=null;this._challenge=null;this.setData({status:null,pending:false,busy:false})},
  base:function(){return '/api/'+(this.data.staff?'admin/':'')+'message-subscriptions'},
  scope:function(){return this.data.staff?{}:{appointmentId:this.data.appointmentId}},
  load:function(){
    var self=this,current=this.guard();this.setData({loading:true,error:''});this._challenge=null
    var query=this.data.staff?'':'?appointmentId='+encodeURIComponent(this.data.appointmentId)
    return portal.call(this.base()+query).then(function(r){
      if(!current())return;self.setData({status:r})
      if(!r.available||self._pending)return
      return portal.call(self.base()+'/challenge','POST',self.scope()).then(function(c){if(current()){self._challenge=c.challengeId;self._challengeDeadline=Date.now()+Math.max(0,Math.min(270,Number(c.expiresInSeconds)||240)-10)*1000}})
    }).catch(function(e){if(current())self.setData({error:e.message})}).then(function(){if(current())self.setData({loading:false})})
  },
  subscribe:function(){
    if(this.data.busy)return
    if(this._pending)return this.saveChoice()
    if(this._challenge && Date.now() >= this._challengeDeadline){this._challenge=null;this.setData({error:'订阅准备已过期，请刷新后再点击订阅，不会自动扣除授权。'});return}
    if(!this._challenge||!this.data.status||!this.data.status.available){wx.showToast({title:'请先刷新订阅状态',icon:'none'});return}
    var self=this,viewer=portal.identity(),templateId=this.data.status.templateId,challenge=this._challenge
    if(typeof wx.requestSubscribeMessage!=='function'){this.setData({error:'当前微信版本不支持，请更新微信后重试'});return}
    this.setData({busy:true,error:''})
    // Invoke directly in the tap handler; do not put authorization behind an async fetch.
    wx.requestSubscribeMessage({tmplIds:[templateId],success:function(r){
      if(self._disposed||viewer!==portal.identity())return
      var result=r[templateId]
      if(['accept','reject','ban'].indexOf(result)===-1){self.setData({busy:false,error:'微信没有返回有效授权结果，请重新刷新'});return}
      self._pending={viewer:viewer,body:Object.assign({},self.scope(),{challengeId:challenge,templateId:templateId,result:result})}
      self._challenge=null;self.setData({busy:false,pending:true});self.saveChoice()
    },fail:function(e){if(!self._disposed&&viewer===portal.identity()){self._challenge=null;self.setData({busy:false,error:'未完成微信授权，请刷新后重试。'+(/cancel/.test(e.errMsg||'')?'':'请使用手机微信操作。')})}}})
  },
  saveChoice:function(){
    if(!this._pending||this.data.busy||this._pending.viewer!==portal.identity())return
    var self=this,pending=this._pending;this.setData({busy:true,error:''})
    return portal.call(this.base(),'POST',pending.body).then(function(){
      if(self._disposed||pending.viewer!==portal.identity())return
      self._pending=null;self.setData({pending:false});wx.showToast({title:pending.body.result==='accept'?'一次授权已登记':'本次未订阅',icon:'none'});return self.load()
    }).catch(function(e){if(!self._disposed&&pending.viewer===portal.identity()){
      if(e.statusCode===409){self._pending=null;self._challenge=null;self.setData({pending:false,error:'本次登记已过期或状态已变化，请刷新后重新订阅。此前授权额度以微信为准。'})}
      else self.setData({error:'登记未成功：'+e.message+'。点击“重试登记”即可，不需要重复授权。'})
    }}).then(function(){if(!self._disposed&&pending.viewer===portal.identity())self.setData({busy:false})})
  },
  pause:function(){if(this.data.busy)return;var self=this,current=this.guard(),viewer=portal.identity();this.setData({busy:true,error:''});return portal.call(this.base(),'DELETE',this.scope()).then(function(){if(current())return self.load()}).catch(function(e){if(self._visible&&viewer===portal.identity())self.setData({error:e.message})}).then(function(){if(!self._disposed&&viewer===portal.identity())self.setData({busy:false})})},
  settings:function(){if(typeof wx.openSetting==='function')wx.openSetting({withSubscriptions:true})}
}))
