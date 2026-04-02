with open('main.py', 'r') as f:
    content = f.read()

old = '        question_answer_chain = create_stuff_documents_chain(llm, prompt)\n        rag_chain = create_retrieval_chain(retriever, question_answer_chain)'

new = '        rag_chain = (\n            {"context": retriever, "input": RunnablePassthrough()}\n            | prompt\n            | llm\n            | StrOutputParser()\n        )'

content = content.replace(old, new)

old2 = '    question_answer_chain = create_stuff_documents_chain(llm, prompt)\n    rag_chain = create_retrieval_chain(retriever, question_answer_chain)'

new2 = '    rag_chain = (\n        {"context": retriever, "input": RunnablePassthrough()}\n        | prompt\n        | llm\n        | StrOutputParser()\n    )'

content = content.replace(old2, new2)

with open('main.py', 'w') as f:
    f.write(content)

print('Done!')
