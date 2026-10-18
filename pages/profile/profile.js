var portal = require('../../utils/portal-api')
var page = require('../../utils/portal-page')
Page(page({
  data: { loading:true,loadFailed:false,avatarFailed:false,error:'',nickname:'',avatar:'',avatarUrl:'',busy:false,uploading:false,choosing:false },
  clearPrivate: function () { this.setData({nickname:'',avatar:'',avatarUrl:'',error:'',busy:false,uploading:false,choosing:false,loadFailed:false,avatarFailed:false}); this._loaded=false;this._pendingAvatar=null },
  onUnload:function(){if(!this.data.busy)portal.discardAll(this._uploads||[])},
  onShow:function(){
    if(this._pendingAvatar){var pending=this._pendingAvatar;this._pendingAvatar=null;if(pending.viewer===portal.identity())return this.uploadAvatar(pending.file,pending.viewer)}
    if(!this._loaded)return this.load()
    if(this.data.loading){
      this.setData({loading:false})
      var self=this,current=this.guard()
      return portal.avatar(this.data.avatar).then(function(url){if(current())self.setData({avatarUrl:url,avatarFailed:false})}).catch(function(e){if(current())self.setData({avatarFailed:true,error:e.message})})
    }
  },
  load: function () {
    var self=this,current=this.guard();this.setData({loading:true,loadFailed:false,avatarFailed:false,error:''})
    return portal.call('/api/portal/me').then(function(r){
      if(!current())return
      self._loaded=true;self.setData({nickname:r.profile.nickname,avatar:r.profile.avatar,avatarUrl:''})
      return portal.avatar(r.profile.avatar).then(function(url){if(current())self.setData({avatarUrl:url})}).catch(function(e){if(current())self.setData({avatarFailed:true,error:e.message})})
    }).catch(function(e){if(current())self.setData({loadFailed:true,error:e.message||'资料加载失败，请重试'})}).then(function(){if(current())self.setData({loading:false})})
  },
  input:function(e){this.setData({nickname:e.detail.value})},
  chooseImage:function(){
    if(this.data.loading||this.data.busy||this.data.uploading||this.data.choosing||this._disposed)return
    var self=this,viewer=portal.identity();this.setData({choosing:true,error:''})
    wx.chooseMedia({count:1,mediaType:['image'],sourceType:['album','camera'],sizeType:['compressed'],
      success:function(result){
        if(self._disposed||viewer!==portal.identity())return
        var file=result.tempFiles&&result.tempFiles[0]
        if(!file||!file.tempFilePath){self.setData({error:'未取得图片，请重新选择'});return}
        if(file.size>5*1024*1024){self.setData({error:'请选择5MB以内的头像图片'});return}
        if(self._visible)self.uploadAvatar(file.tempFilePath,viewer)
        else self._pendingAvatar={file:file.tempFilePath,viewer:viewer}
      },
      fail:function(error){
        if(self._disposed||viewer!==portal.identity()||/cancel/i.test(error&&error.errMsg||''))return
        var message=error&&error.errMsg||''
        self.setData({error:/privacy|scope is not declared/i.test(message)?'图片选择暂不可用，请联系管理员完善微信隐私保护指引中的图片选取声明。':'无法打开图片选择，请检查微信的相册或相机权限后重试。'})
      },
      complete:function(){if(!self._disposed&&viewer===portal.identity())self.setData({choosing:false})}
    })
  },
  uploadAvatar:function(filePath,viewer){
    if(this._disposed||viewer!==portal.identity())return Promise.resolve()
    var self=this;this.setData({uploading:true,error:''})
    return portal.upload(filePath).then(function(path){
      if(self._disposed){if(viewer===portal.identity())portal.discard(path);return}
      if(viewer!==portal.identity())return
      portal.discardAll(self._uploads||[]);self._uploads=[path]
      self.setData({avatar:path,avatarUrl:filePath,avatarFailed:false})
    }).catch(function(e){if(!self._disposed&&viewer===portal.identity())self.setData({error:e.message||'头像上传失败，请重试'})}).then(function(){if(!self._disposed&&viewer===portal.identity())self.setData({uploading:false})})
  },
  avatarError:function(){
    if(!this.data.avatarUrl)return
    portal.forgetAvatar(this.data.avatar)
    this.setData({avatarUrl:'',avatarFailed:true,error:'头像加载失败，请重新加载资料或重新选择图片'})
  },
  save:function(){
    if(this.data.loading||this.data.loadFailed||this.data.busy||this.data.uploading||this.data.choosing)return
    if(!this.data.nickname.trim()){this.setData({error:'请填写昵称'});return}
    var self=this,current=this.guard(),uploads=this._uploads||[];this.setData({busy:true,error:''})
    return portal.call('/api/portal/me','PUT',{nickname:this.data.nickname.trim(),avatar:this.data.avatar}).then(function(){portal.discardAll(uploads);if(self._uploads===uploads)self._uploads=[];if(current()){wx.showToast({title:'资料已保存'});wx.navigateBack()}}).catch(function(e){if(current())self.setData({error:e.message})}).then(function(){if(self._disposed)portal.discardAll(uploads);else self.setData({busy:false})})
  }
}))
