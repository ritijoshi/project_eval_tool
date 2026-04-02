with open('main.py', 'r') as f:
    content = f.read()

# Fix /chat endpoint response
old1 = 'response = rag_chain.invoke({\n            \"input\": req.message,\n            \"chat_history\": chat_history_messages\n        })\n        return ChatResponse(reply=response[\"answer\"])'
new1 = 'response = rag_chain.invoke(req.message)\n        return ChatResponse(reply=response)'

# Fix /course/chat endpoint response  
old2 = 'response = rag_chain.invoke({\n        \"input\": req.message,\n        \"chat_history\": chat_history_messages,\n    })\n\n    return ChatResponse(reply=response.get(\"answer\", \"\"))'
new2 = 'response = rag_chain.invoke(req.message)\n    return ChatResponse(reply=response)'

content = content.replace(old1, new1)
content = content.replace(old2, new2)

with open('main.py', 'w') as f:
    f.write(content)

print('Done!')
