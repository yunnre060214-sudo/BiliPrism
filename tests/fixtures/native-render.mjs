// Vue 2 管理整个视频页，包括播放器相邻的文本节点，与线上初始化方式对应。
export function nativeRender(h) {
  return h('div', { attrs: { id: 'app' } }, [
    h('div', { class: 'video-container-v1' }, [
      h('div', { class: 'left-container' }, [
        h('h1', '原生初始化与播放回归'), ' ',
        h('div', { attrs: { id: 'playerWrap' } }, [
          h('div', { attrs: { id: 'bilibili-player' }, style: { width: '640px', height: '360px' } }, [
            h('video', { attrs: { id: 'native-video', src: 'https://www.bilibili.com/test-playback.webm', muted: true, loop: true, playsinline: true, preload: 'auto' }, domProps: { muted: true }, style: { width: '100%', height: '100%' } }),
          ]),
        ]), ' ',
        h('div', { attrs: { id: 'native-toolbar' } }, this.hydrated ? '原生初始化完成' : '等待原生初始化'),
      ]),
      h('div', { class: 'right-container' }, [
        h('img', { attrs: { id: 'native-cover', src: 'https://www.bilibili.com/test-cover.svg' } }),
      ]),
    ]),
  ]);
}
