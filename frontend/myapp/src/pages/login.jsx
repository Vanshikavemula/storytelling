import { useState, useContext } from "react";
import { login } from "../services/authService";
import { AuthContext } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";

export default function Login() {

  const [username,setUsername] = useState("");
  const [password,setPassword] = useState("");

  const { loadUser } = useContext(AuthContext);
  const navigate = useNavigate();

  const handleLogin = async () => {

    await login({username,password});

    await loadUser();

    navigate("/chatbot");

  };

  return (

    <div className="hero">

      <div className="card" style={{padding:"40px",maxWidth:"500px",margin:"auto"}}>

        <h2 style={{marginBottom:"20px"}}>Login</h2>

        <input
          className="field-input"
          placeholder="Username"
          onChange={(e)=>setUsername(e.target.value)}
        />

        <br/><br/>

        <input
          className="field-input"
          type="password"
          placeholder="Password"
          onChange={(e)=>setPassword(e.target.value)}
        />

        <br/><br/>

        <button
          className="primary-btn"
          onClick={handleLogin}
        >
          Login
        </button>

      </div>

    </div>

  );
}