<template>
  <div class="container">
    <div class="header">
      <h1 class="title">Claude Chat</h1>
      <div class="model-selector">
        <label for="model">Model:</label>
        <select id="model" v-model="selectedModel">
          <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
          <option value="claude-3-5-haiku-20241022">Claude 3.5 Haiku</option>
          <option value="claude-3-opus-20240229">Claude 3 Opus</option>
        </select>
      </div>
    </div>

    <div class="messages" ref="messagesContainer">
      <div v-if="error" class="error">{{ error }}</div>
      <div v-for="message in messages" :key="message.id" :class="['message', message.role]">
        <div class="message-content">{{ message.content }}</div>
      </div>
      <div v-if="isStreaming" class="message assistant">
        <div class="message-content">{{ currentResponse }}</div>
      </div>
    </div>

    <div class="input-area">
      <div class="input-container">
        <input 
          v-model="currentMessage" 
          @keyup.enter="sendMessage"
          placeholder="Type your message..."
          :disabled="isStreaming"
        >
        <button @click="sendMessage" :disabled="isStreaming || !currentMessage.trim()" :hidden="isStreaming">
          {{ isStreaming ? 'Sending...' : 'Send' }}
        </button>
        <button @click="cancelRequest" class="cancel-button"  :hidden="!isStreaming">
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'App',
  data() {
    return {
      messages: [],
      currentMessage: '',
      currentResponse: '',
      selectedModel: 'claude-3-5-sonnet-20241022',
      isStreaming: false,
      error: null,
      sessionId: ''
    }
  },
  methods: {
    async sendMessage() {
      if (!this.currentMessage.trim() || this.isStreaming) return

      const userMessage = {
        role: 'user',
        content: this.currentMessage
      }

      this.messages.push(userMessage)
      this.currentMessage = ''
      this.currentResponse = ''
      this.isStreaming = true
      this.error = null
      this.sessionId = crypto.randomUUID()

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messages: this.messages,
            model: this.selectedModel,
            sessionId: this.sessionId,
          })
        })

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value)
          const lines = chunk.split('\n')

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6)
              if (data === '[DONE]') {
                this.finishStream()
                return
              }
              this.currentResponse += data
              this.scrollToBottom()
            }
          }
        }

      } catch (error) {
        this.error = `Error: ${error.message}`
        this.isStreaming = false
      }
    },
    async cancelRequest() {
      try {
        const response = await fetch('/api/cancel', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sessionId: this.sessionId
          }),
        })
        
        this.finishStream()
        
        if (!response.ok) {
          throw new Error(`Error cancelling request: ${response.status}`)
        }
      } catch (error) {
        this.error = `Error: ${error.message}`
      }
    },
    scrollToBottom() {
      this.$nextTick(() => {
        const container = this.$refs.messagesContainer
        container.scrollTop = container.scrollHeight
      })
    },
    finishStream() {
      this.messages.push({
        role: 'assistant',
        content: this.currentResponse
      })
      this.currentResponse = ''
      this.isStreaming = false
    }


  },
  mounted() {
    this.scrollToBottom()
  },
  updated() {
    this.scrollToBottom()
  }
}
</script>
<style scoped>
  .cancel-button {
    color: white;
    background: #FF0000;
    padding: 0.75rem 1.5rem;
    border: none;
    border-radius: 0.375rem;
    cursor: pointer;
  }

  .cancel-button:hover {
    background: #861600;
  } 

</style>
